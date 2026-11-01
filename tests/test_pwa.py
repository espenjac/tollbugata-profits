"""Tester for installasjon av samme webapp som PWA på mobil og desktop."""

from __future__ import annotations

import json
import struct
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.client import HTTPConnection
from pathlib import Path

from app import ScreenerHTTPServer
from oslo_screener.config import Settings
from oslo_screener.data import Universe
from oslo_screener.journal import load_journal
from oslo_screener.logic import Criteria, screen
from oslo_screener.models import Stock
from oslo_screener.pwa import (
    ICON_PATHS,
    MASKABLE_ICON_PATH,
    icon_for_path,
    icon_png,
    manifest_payload,
)
from oslo_screener.render import (
    render_dashboard,
    render_journal_page,
    render_offline_page,
)


def make_stock() -> Stock:
    return Stock(
        ticker="EQNR",
        name="Equinor ASA",
        close=100.0,
        currency="NOK",
        week_return=0.02,
        month_return=0.05,
        quarter_return=0.10,
        sma5=98.0,
        sma20=95.0,
        sma50=90.0,
        rsi=55.0,
        ath=110.0,
        high_52w=110.0,
        market_cap=1_000_000_000_000.0,
        volume=1_000_000.0,
        sector="Energy",
        instrument_type="stock",
        average_volume_10d=1_000_000.0,
        atr=2.5,
    )


def make_universe(stocks: list[Stock]) -> Universe:
    return Universe(
        stocks=stocks,
        fetched_at=datetime.now(timezone.utc),
        source="test",
    )


def png_size(data: bytes) -> tuple[int, int]:
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise AssertionError("ikke en PNG-fil")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


class PwaAssetTests(unittest.TestCase):
    def test_manifest_is_installable_and_uses_same_routes(self) -> None:
        manifest = manifest_payload()
        self.assertEqual(manifest["start_url"], "/")
        self.assertEqual(manifest["scope"], "/")
        self.assertEqual(manifest["display"], "standalone")
        self.assertEqual(manifest["lang"], "nb")
        sizes = {icon["sizes"] for icon in manifest["icons"]}
        self.assertIn("192x192", sizes)
        self.assertIn("512x512", sizes)
        self.assertIn(
            MASKABLE_ICON_PATH,
            [icon["src"] for icon in manifest["icons"]],
        )
        self.assertEqual(
            [shortcut["url"] for shortcut in manifest["shortcuts"]],
            ["/", "/logg"],
        )

    def test_icons_are_valid_png_files(self) -> None:
        for size, path in ICON_PATHS.items():
            data = icon_png(size)
            self.assertEqual(png_size(data), (size, size))
            self.assertEqual(icon_for_path(path), (data, size))
        maskable = icon_png(512, maskable=True)
        self.assertEqual(png_size(maskable), (512, 512))
        self.assertEqual(icon_for_path(MASKABLE_ICON_PATH), (maskable, 512))
        self.assertEqual(icon_for_path("/favicon.ico")[1], 32)
        self.assertIsNone(icon_for_path("/icons/missing.png"))

    def test_pages_have_manifest_and_install_support(self) -> None:
        stock = make_stock()
        universe = make_universe([stock])
        result = screen([stock], Criteria())
        dashboard = render_dashboard(result, universe, Criteria(), web_mode=True)
        journal = render_journal_page(load_journal(Path("/does/not/exist")))
        for page in (dashboard, journal):
            self.assertIn('rel="manifest" href="/manifest.webmanifest"', page)
            self.assertIn('name="theme-color" content="#080d19"', page)
            self.assertIn('id="install-banner"', page)
            self.assertIn('navigator.serviceWorker.register("/sw.js")', page)
            self.assertIn("(display-mode: standalone)", page)
        self.assertIn("Ingen forbindelse", render_offline_page())


class PwaHTTPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.server = ScreenerHTTPServer(
            ("127.0.0.1", 0),
            defaults=Criteria(),
            cache_ttl=60,
            http_timeout=1.0,
            sort_by="week",
            include_news=False,
            settings=Settings(),
            journal_path=Path(self.directory.name) / "journal.json",
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.directory.cleanup()

    def _get(self, path: str) -> tuple[int, dict[str, str], bytes]:
        connection = HTTPConnection(
            "127.0.0.1", self.server.server_address[1], timeout=3
        )
        connection.request("GET", path)
        response = connection.getresponse()
        body = response.read()
        headers = {key.lower(): value for key, value in response.getheaders()}
        connection.close()
        return response.status, headers, body

    def test_manifest_and_service_worker_are_served(self) -> None:
        status, headers, body = self._get("/manifest.webmanifest")
        self.assertEqual(status, 200)
        self.assertIn("application/manifest+json", headers["content-type"])
        self.assertEqual(json.loads(body)["display"], "standalone")
        self.assertIn("manifest-src 'self'", headers["content-security-policy"])

        status, headers, body = self._get("/sw.js")
        self.assertEqual(status, 200)
        self.assertIn("text/javascript", headers["content-type"])
        self.assertEqual(headers["service-worker-allowed"], "/")
        self.assertIn("no-cache", headers["cache-control"])
        self.assertIn(b'caches.match("/offline")', body)

    def test_offline_page_and_icons_are_served(self) -> None:
        status, headers, body = self._get("/offline")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["content-type"])
        self.assertIn(b"Ingen forbindelse", body)

        status, headers, body = self._get("/icons/icon-192.png")
        self.assertEqual(status, 200)
        self.assertEqual(headers["content-type"], "image/png")
        self.assertEqual(png_size(body), (192, 192))

        status, _headers, _body = self._get("/icons/missing.png")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
