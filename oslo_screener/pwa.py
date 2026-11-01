"""PWA-data for installasjon av samme webapp på mobil og desktop.

Modulen inneholder bare metadata, tjenestearbeideren og genererte ikoner. All
forretningslogikk og alle visninger er fortsatt de samme som i webappen.
"""

from __future__ import annotations

import json
import math
import struct
import zlib
from functools import lru_cache
from typing import Any

APP_NAME = "Tollbugata Profits"
SHORT_NAME = "Tollbugata"
THEME_COLOR = "#080d19"
BACKGROUND_COLOR = "#080d19"
MANIFEST_PATH = "/manifest.webmanifest"
SERVICE_WORKER_PATH = "/sw.js"
OFFLINE_PATH = "/offline"
ICON_PATHS = {
    192: "/icons/icon-192.png",
    512: "/icons/icon-512.png",
}
MASKABLE_ICON_PATH = "/icons/icon-maskable-512.png"


def manifest_payload() -> dict[str, Any]:
    """Returner web-app-manifestet som Android og desktop kan installere."""
    return {
        "id": "/",
        "name": APP_NAME,
        "short_name": SHORT_NAME,
        "description": (
            "Pre-market daytrading-rapport for Oslo Børs med manuell "
            "handelsplan, backtest og lokal handelsdagbok."
        ),
        "lang": "nb",
        "dir": "ltr",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "display_override": ["standalone", "minimal-ui"],
        "orientation": "any",
        "background_color": BACKGROUND_COLOR,
        "theme_color": THEME_COLOR,
        "categories": ["finance", "business", "productivity"],
        "icons": [
            {
                "src": ICON_PATHS[192],
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": ICON_PATHS[512],
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": MASKABLE_ICON_PATH,
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            },
        ],
        "shortcuts": [
            {
                "name": "Kursinformasjon",
                "short_name": "Kurs",
                "url": "/",
                "icons": [{"src": ICON_PATHS[192], "sizes": "192x192"}],
            },
            {
                "name": "Handelsdagbok",
                "short_name": "Dagbok",
                "url": "/logg",
                "icons": [{"src": ICON_PATHS[192], "sizes": "192x192"}],
            },
        ],
    }


def manifest_json() -> bytes:
    return (json.dumps(manifest_payload(), ensure_ascii=False, indent=2) + "\n").encode(
        "utf-8"
    )


SERVICE_WORKER_JS = """\
"use strict";

const CACHE_NAME = "tollbugata-profits-v1";
const STATIC_ASSETS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline"))
    );
    return;
  }

  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});
"""


def _chunk(chunk_type: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def _distance_to_segment(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
) -> float:
    dx = bx - ax
    dy = by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _blend(
    base: tuple[int, int, int],
    color: tuple[int, int, int],
    alpha: float,
) -> tuple[int, int, int]:
    if alpha <= 0:
        return base
    alpha = min(1.0, alpha)
    return tuple(
        int(round(base[index] * (1.0 - alpha) + color[index] * alpha))
        for index in range(3)
    )


def _png(width: int, height: int, pixels: bytearray) -> bytes:
    raw = b"".join(
        b"\x00" + bytes(pixels[row * width * 4 : (row + 1) * width * 4])
        for row in range(height)
    )
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )


@lru_cache(maxsize=8)
def icon_png(size: int, maskable: bool = False) -> bytes:
    """Lag et enkelt, mørkt app-ikon med en teal kurve.

    Ikonet genereres med standardbiblioteket, slik at prosjektet ikke trenger
    binære filer eller eksterne bildeverktøy.
    """
    if size < 16 or size > 1024:
        raise ValueError("ikonstørrelsen må være mellom 16 og 1024 piksler")

    if maskable:
        points = (
            (0.27, 0.68),
            (0.43, 0.54),
            (0.56, 0.60),
            (0.75, 0.34),
        )
        dot = (0.75, 0.34)
    else:
        points = (
            (0.18, 0.70),
            (0.38, 0.52),
            (0.53, 0.61),
            (0.80, 0.30),
        )
        dot = (0.80, 0.30)

    scaled = tuple((x * size, y * size) for x, y in points)
    line_width = max(2.0, size * 0.065)
    glow_width = max(line_width, size * 0.17)
    dot_radius = max(2.0, size * 0.055)
    dot_x, dot_y = dot[0] * size, dot[1] * size
    pixels = bytearray(size * size * 4)

    for y in range(size):
        py = y + 0.5
        for x in range(size):
            px = x + 0.5
            glow = math.hypot(px - size * 0.22, py - size * 0.12) / (size * 1.15)
            glow = max(0.0, min(1.0, glow))
            red = int(round(12 * (1.0 - glow) + 7 * glow))
            green = int(round(24 * (1.0 - glow) + 11 * glow))
            blue = int(round(48 * (1.0 - glow) + 23 * glow))
            base = (red, green, blue)

            distance = min(
                _distance_to_segment(px, py, ax, ay, bx, by)
                for (ax, ay), (bx, by) in zip(scaled, scaled[1:])
            )
            if distance < glow_width:
                alpha = max(0.0, 1.0 - distance / glow_width) ** 2 * 0.20
                base = _blend(base, (56, 189, 248), alpha)

            line_alpha = max(0.0, min(1.0, line_width / 2.0 + 1.0 - distance))
            base = _blend(base, (94, 234, 212), line_alpha)

            dot_distance = math.hypot(px - dot_x, py - dot_y)
            dot_alpha = max(
                0.0, min(1.0, dot_radius + 1.0 - dot_distance)
            )
            base = _blend(base, (226, 255, 250), dot_alpha)

            offset = (y * size + x) * 4
            pixels[offset : offset + 4] = bytes((*base, 255))

    return _png(size, size, pixels)


def icon_for_path(path: str) -> tuple[bytes, int] | None:
    """Finn PNG-data og størrelse for en ikon-URL."""
    if path == MASKABLE_ICON_PATH:
        return icon_png(512, maskable=True), 512
    for size, icon_path in ICON_PATHS.items():
        if path == icon_path:
            return icon_png(size), size
    if path == "/favicon.ico":
        return icon_png(32), 32
    return None
