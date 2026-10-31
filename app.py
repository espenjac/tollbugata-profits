#!/usr/bin/env python3
"""Tollbugata Profits – lokal webapp for Oslo Børs-ukescreen.

Kjør:
    python app.py
og åpne http://127.0.0.1:8501 i nettleseren.
"""

from __future__ import annotations

import argparse
import html
import json
import sys
import threading
import webbrowser
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional
from urllib.parse import parse_qs, urlencode, urlparse

from oslo_screener.cli import add_common_arguments, criteria_from_args
from oslo_screener.data import DataSourceError, fetch_universe
from oslo_screener.logic import Criteria, screen
from oslo_screener.news import fetch_news
from oslo_screener.render import render_dashboard
from oslo_screener.serialize import result_to_dict


def _float_param(
    query: dict[str, list[str]],
    name: str,
    default: float,
    low: float,
    high: float,
) -> float:
    values = query.get(name)
    if not values:
        return default
    try:
        value = float(values[0].replace(",", "."))
    except (TypeError, ValueError):
        return default
    if value != value:  # NaN
        return default
    return min(high, max(low, value))


def criteria_from_query(query: dict[str, list[str]], defaults: Criteria) -> Criteria:
    """Leser filtere fra URL-en, med trygge grenser."""
    return replace(
        defaults,
        min_week_return=_float_param(
            query, "min_week", defaults.min_week_return * 100, -100.0, 100.0
        )
        / 100.0,
        ath_margin=_float_param(
            query, "ath_margin", defaults.ath_margin * 100, 0.0, 50.0
        )
        / 100.0,
        require_above_sma5="1"
        in query.get("sma5", ["1" if defaults.require_above_sma5 else "0"]),
        require_above_sma20="1"
        in query.get("sma20", ["1" if defaults.require_above_sma20 else "0"]),
        include_at_high="1"
        in query.get("ath", ["1" if defaults.include_at_high else "0"]),
        exclude_growth="1"
        not in query.get("growth", ["0" if defaults.exclude_growth else "1"]),
    )


class ScreenerHandler(BaseHTTPRequestHandler):
    server_version = "TollbugataProfits/1.0"

    @property
    def app(self) -> "ScreenerHTTPServer":
        return self.server  # type: ignore[return-value]

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler-API)
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query, keep_blank_values=True)

        if parsed.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        try:
            if parsed.path == "/api/data":
                self._serve_api(query)
            elif parsed.path == "/refresh":
                fetch_universe(
                    cache_ttl=self.app.cache_ttl,
                    force=True,
                    timeout=self.app.http_timeout,
                )
                if self.app.include_news:
                    fetch_news(
                        force=True,
                        timeout=min(self.app.http_timeout, 10.0),
                        retries=1,
                    )
                location = "/" + (f"?{parsed.query}" if parsed.query else "")
                self.send_response(303)
                self.send_header("Location", location)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
            elif parsed.path == "/":
                self._serve_dashboard(query)
            else:
                self._send(
                    404,
                    "text/plain; charset=utf-8",
                    b"Fant ikke siden. Prov / eller /api/data.\n",
                )
        except DataSourceError as exc:
            self._serve_error(str(exc))

    def _serve_dashboard(self, query: dict[str, list[str]]) -> None:
        criteria = criteria_from_query(query, self.app.defaults)
        universe = fetch_universe(
            cache_ttl=self.app.cache_ttl,
            timeout=self.app.http_timeout,
        )
        result = screen(universe.stocks, criteria)
        news = (
            fetch_news(timeout=self.app.http_timeout)
            if self.app.include_news
            else None
        )
        refresh_url = "/refresh"
        if query:
            refresh_url += "?" + urlencode(query, doseq=True)
        page = render_dashboard(
            result,
            universe,
            criteria,
            sort_by=self.app.sort_by,
            web_mode=True,
            refresh_url=refresh_url,
            news=news,
        )
        self._send(200, "text/html; charset=utf-8", page.encode("utf-8"))

    def _serve_api(self, query: dict[str, list[str]]) -> None:
        criteria = criteria_from_query(query, self.app.defaults)
        universe = fetch_universe(
            cache_ttl=self.app.cache_ttl,
            timeout=self.app.http_timeout,
        )
        result = screen(universe.stocks, criteria)
        news = (
            fetch_news(timeout=self.app.http_timeout)
            if self.app.include_news
            else None
        )
        payload = result_to_dict(
            result,
            universe,
            criteria,
            sort_by=self.app.sort_by,
            news=news,
        )
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self._send(200, "application/json; charset=utf-8", body)

    def _serve_error(self, message: str) -> None:
        page = f"""<!doctype html>
<html lang="nb">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kunne ikke hente data · Tollbugata Profits</title>
  <style>
    body {{ margin: 0; min-height: 100vh; display: grid; place-items: center;
           background: #080d19; color: #e8eeff; font-family: system-ui, sans-serif; }}
    main {{ max-width: 620px; margin: 24px; padding: 28px; border: 1px solid #223354;
            border-radius: 16px; background: #111b31; box-shadow: 0 24px 60px rgba(0,0,0,.35); }}
    h1 {{ margin-top: 0; font-size: 24px; }}
    p {{ color: #8fa0c4; line-height: 1.6; }}
    code {{ color: #fbbf24; }}
    a {{ display: inline-block; margin-top: 10px; padding: 10px 16px; border-radius: 9px;
         background: linear-gradient(135deg, #5eead4, #38bdf8); color: #04121c;
         font-weight: 700; text-decoration: none; }}
  </style>
</head>
<body>
  <main>
    <h1>Kunne ikke hente aksjedata</h1>
    <p>{html.escape(message)}</p>
    <p>Dette skjer typisk hvis TradingView-scanneren er midlertidig utilgjengelig,
       eller hvis datamaskinen er uten nett.</p>
    <a href="/">Prov igjen</a>
  </main>
</body>
</html>
"""
        self._send(502, "text/html; charset=utf-8", page.encode("utf-8"))

    def _send(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
            "img-src data:; form-action 'self'; base-uri 'none'",
        )
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        # Hold terminalen ren; vis bare feil.
        if len(args) >= 2 and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


class ScreenerHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        defaults: Criteria,
        cache_ttl: int,
        http_timeout: float,
        sort_by: str,
        include_news: bool = True,
    ) -> None:
        self.defaults = defaults
        self.cache_ttl = cache_ttl
        self.http_timeout = http_timeout
        self.sort_by = sort_by
        self.include_news = include_news
        super().__init__(server_address, ScreenerHandler)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="app.py",
        description="Lokal webapp som viser Oslo Børs-aksjer med positiv uketrend, men under ATH.",
    )
    add_common_arguments(parser)
    parser.add_argument("--host", default="127.0.0.1", help="lytteadresse (standard: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8501, help="port (standard: 8501)")
    parser.add_argument("--no-browser", action="store_true", help="åpne ikke nettleseren automatisk")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    defaults = criteria_from_args(args)

    try:
        server = ScreenerHTTPServer(
            (args.host, args.port),
            defaults=defaults,
            cache_ttl=args.cache_ttl,
            http_timeout=args.timeout,
            sort_by=args.sort,
            include_news=not args.no_news,
        )
    except OSError as exc:
        print(f"Kunne ikke starte på {args.host}:{args.port}: {exc}", file=sys.stderr)
        return 1

    display_host = "127.0.0.1" if args.host in ("0.0.0.0", "::", "") else args.host
    url = f"http://{display_host}:{args.port}/"
    print(f"Tollbugata Profits kjører på {url}")
    print("Trykk Ctrl+C for å stoppe.")

    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopper.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
