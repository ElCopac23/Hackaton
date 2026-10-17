#!/usr/bin/env python3
"""Draw the DemetrAg app icons (green square, three white furrows) as PNG files.

Usage: python3 scripts/make_icons.py   -> web/app/icons/icon-180.png, icon-192.png, icon-512.png
Pure standard library (zlib + struct), no image packages needed.
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "app", "icons")
GREEN = (46, 107, 79)
CREAM = (244, 242, 236)
# Furrows of the logo on a 32x32 grid: cubic Bezier curves (start, control 1, control 2, end).
CURVES = [
    ((7, 22), (11, 21), (14, 18), (16, 13)),
    ((7, 26), (13, 25), (18, 21), (20, 14)),
    ((7, 30), (15, 29), (21, 24), (24, 15)),
]


def bezier(p0, p1, p2, p3, t):
    u = 1 - t
    return tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3))


def draw(size):
    px = [[GREEN for _ in range(size)] for _ in range(size)]
    # The logo occupies the centre of the icon; shift it up a little to balance the curves.
    scale = size / 32 * 0.95
    off_x = size * 0.06
    off_y = -size * 0.10
    radius = 1.25 * scale
    for curve in CURVES:
        for i in range(600):
            x, y = bezier(*curve, i / 599)
            cx, cy = x * scale + off_x, y * scale + off_y
            for yy in range(int(cy - radius - 1), int(cy + radius + 2)):
                for xx in range(int(cx - radius - 1), int(cx + radius + 2)):
                    if 0 <= xx < size and 0 <= yy < size:
                        d = ((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2) ** 0.5
                        cover = max(0.0, min(1.0, radius + 0.5 - d))  # soft edge
                        if cover > 0:
                            base = px[yy][xx]
                            px[yy][xx] = tuple(round(b + (c - b) * cover) for b, c in zip(base, CREAM))
    return px


def write_png(path, px):
    size = len(px)
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in px)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for size in (180, 192, 512):
        write_png(os.path.join(OUT, f"icon-{size}.png"), draw(size))
        print(f"icon-{size}.png")
