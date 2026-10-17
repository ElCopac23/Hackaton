#!/usr/bin/env python3
"""Serve the farm home page locally without browser caching.

Usage (from the farm-assistant folder):  python3 scripts/serve.py [port]
Then open http://127.0.0.1:8765/
"""
import functools
import http.server
import os
import sys

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCacheHandler, directory=WEB)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Farm home: http://127.0.0.1:{port}/")
        httpd.serve_forever()
