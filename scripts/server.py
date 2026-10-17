#!/usr/bin/env python3
"""DemetrAg sync server: serves the farm home (web) and the phone app, and keeps
records, notes and photos in sync between them in real time.

Usage (from the farm-assistant folder):
    python3 scripts/server.py          # this Mac only:  http://127.0.0.1:8765/
    python3 scripts/server.py --lan    # also reachable from a phone on the same Wi-Fi

With --lan, devices other than this Mac need the access key that is part of the
phone link printed at start-up. The farm data is derived from the hackathon
dataset: keep it on your own network, never on a public server.

Live updates use Server-Sent Events (/api/events): every change bumps a version
number and all connected pages refresh within a second.
"""
import argparse
import base64
import functools
import http.server
import json
import os
import re
import secrets
import socket
import threading
import time
import uuid
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
DATA = os.path.join(ROOT, "server-data")
PHOTOS = os.path.join(DATA, "photos")
STATE_FILE = os.path.join(DATA, "state.json")
KEY_FILE = os.path.join(DATA, "access-key.txt")
MAX_BODY = 12 * 1024 * 1024
PUBLIC_PATHS = ("/app/manifest.webmanifest", "/app/icons/")


class Store:
    """Shared state, saved to server-data/state.json after every change."""

    def __init__(self):
        self.cond = threading.Condition()
        self.state = {"version": 0, "captured": [], "stockAdjust": {}, "notes": []}
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE) as f:
                self.state.update(json.load(f))

    def snapshot(self):
        with self.cond:
            return json.loads(json.dumps(self.state))

    def update(self, change):
        with self.cond:
            change(self.state)
            self.state["version"] += 1
            tmp = STATE_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.state, f)
            os.replace(tmp, STATE_FILE)
            self.cond.notify_all()
            return json.loads(json.dumps(self.state))

    def wait_for_change(self, version, timeout):
        with self.cond:
            self.cond.wait_for(lambda: self.state["version"] != version, timeout)
            return self.state["version"]


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # no packet is sent; picks the outgoing interface
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def load_key():
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE) as f:
            return f.read().strip()
    key = "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(6))
    with open(KEY_FILE, "w") as f:
        f.write(key)
    return key


def save_photo(data_url):
    m = re.match(r"^data:image/(jpeg|png);base64,(.+)$", data_url or "", re.S)
    if not m:
        raise ValueError("photo must be a JPEG or PNG data URL")
    raw = base64.b64decode(m.group(2), validate=True)
    if not (raw.startswith(b"\xff\xd8") or raw.startswith(b"\x89PNG")):
        raise ValueError("photo content is not JPEG or PNG")
    name = f"{uuid.uuid4().hex[:16]}.{'jpg' if m.group(1) == 'jpeg' else 'png'}"
    with open(os.path.join(PHOTOS, name), "wb") as f:
        f.write(raw)
    return f"photos/{name}"


class Handler(http.server.SimpleHTTPRequestHandler):
    store = None
    key = None
    lan = False
    phone_url = None

    def log_message(self, fmt, *args):  # quieter console: API calls only
        if "/api/" in (self.path or "") and "/api/events" not in self.path:
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        if getattr(self, "_set_cookie", False):
            self.send_header("Set-Cookie", f"dk={self.key}; Path=/; Max-Age=31536000; SameSite=Lax")
        super().end_headers()

    # ----- access control -----
    def is_local(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def authorised(self):
        self._set_cookie = False
        if self.is_local():
            return True
        query = parse_qs(urlparse(self.path).query)
        if query.get("k", [""])[0] == self.key:
            self._set_cookie = True
            return True
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return "dk" in cookie and cookie["dk"].value == self.key

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def forbid(self):
        body = (b"<!doctype html><meta name=viewport content='width=device-width'>"
                b"<body style='font-family:system-ui;padding:24px'><h2>DemetrAg</h2>"
                b"<p>Open the phone link shown in the terminal or on the farm home (it contains the access key).</p>")
        self.send_response(403)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ----- GET -----
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith(PUBLIC_PATHS):
            return super().do_GET()
        if not self.authorised():
            return self.forbid()
        if path == "/api/state":
            return self.send_json(self.store.snapshot())
        if path == "/api/info":
            if not self.is_local():
                return self.send_json({"lan": self.lan})
            return self.send_json({"lan": self.lan, "phoneUrl": self.phone_url})
        if path == "/api/events":
            return self.stream_events()
        if path.startswith("/photos/"):
            name = path.rsplit("/", 1)[-1]
            if not re.fullmatch(r"[0-9a-f]{16}\.(jpg|png)", name):
                return self.send_error(404)
            file = os.path.join(PHOTOS, name)
            if not os.path.exists(file):
                return self.send_error(404)
            with open(file, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg" if name.endswith("jpg") else "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return None
        # A visit with ?k= also stores the key in a cookie (see end_headers). The key stays in the
        # page URL so "Add to Home Screen" on iOS keeps it: home-screen apps have their own cookies.
        return super().do_GET()

    def stream_events(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        version = self.store.snapshot()["version"]
        try:
            self.wfile.write(f"event: update\ndata: {json.dumps({'version': version})}\n\n".encode())
            self.wfile.flush()
            while True:
                new = self.store.wait_for_change(version, 15)
                if new != version:
                    version = new
                    self.wfile.write(f"event: update\ndata: {json.dumps({'version': version})}\n\n".encode())
                else:
                    self.wfile.write(b": keep-alive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    # ----- POST -----
    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            raise ValueError("empty or too large request")
        return json.loads(self.rfile.read(length))

    def do_POST(self):
        if not self.authorised():
            return self.forbid()
        path = urlparse(self.path).path
        try:
            body = self.read_json() if path != "/api/reset" else {}
            if path == "/api/records":
                events = body.get("events", [])
                adjust = body.get("adjust", {})
                if not isinstance(events, list) or not all(isinstance(e, dict) and e.get("parcel") for e in events):
                    raise ValueError("events must be a list of records")

                def add(state):
                    state["captured"].extend(events)
                    for pid, delta in adjust.items():
                        state["stockAdjust"][pid] = state["stockAdjust"].get(pid, 0) + float(delta)
                return self.send_json(self.store.update(add))
            if path == "/api/notes":
                text = str(body.get("text", "")).strip()[:4000]
                photo = save_photo(body["photo"]) if body.get("photo") else None
                if not text and not photo:
                    raise ValueError("a note needs text or a photo")
                note = {
                    "id": uuid.uuid4().hex[:12], "target": str(body.get("target", "farm")),
                    "date": str(body.get("date", ""))[:10], "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "text": text, "tags": [str(t)[:30] for t in body.get("tags", [])][:10], "photo": photo,
                    "device": str(body.get("device", "web"))[:10], "channel": str(body.get("channel", "text"))[:10],
                }
                return self.send_json(self.store.update(lambda state: state["notes"].append(note)))
            if path == "/api/reset":
                def clear(state):
                    state["captured"] = []
                    state["stockAdjust"] = {}
                    state["notes"] = []
                return self.send_json(self.store.update(clear))
            return self.send_error(404)
        except (ValueError, KeyError, json.JSONDecodeError) as err:
            return self.send_json({"error": str(err)}, status=400)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lan", action="store_true", help="accept connections from other devices on the same network")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    os.makedirs(PHOTOS, exist_ok=True)

    Handler.store = Store()
    Handler.key = load_key()
    Handler.lan = args.lan
    ip = lan_ip()
    Handler.phone_url = f"http://{ip}:{args.port}/app/?k={Handler.key}" if args.lan else None
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    handler = functools.partial(Handler, directory=WEB)
    server = http.server.ThreadingHTTPServer((host, args.port), handler)
    server.daemon_threads = True
    print(f"DemetrAg farm home:  http://127.0.0.1:{args.port}/")
    print(f"Phone app (this Mac): http://127.0.0.1:{args.port}/app/")
    if args.lan:
        print(f"Phone app (iPhone on the same Wi-Fi): {Handler.phone_url}")
    else:
        print("Start with --lan to open the phone app from an iPhone on the same Wi-Fi.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
