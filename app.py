#!/usr/bin/env python3
"""Tollbugata Profits – webapp for Oslo Børs pre-market.

Kjør lokalt:
    python app.py
og åpne http://127.0.0.1:8501 i nettleseren.

For sky eller fjernbruk:
    TP_PASSWORD='...' TP_SECRET='...' python app.py --host 0.0.0.0 --no-browser
"""

from __future__ import annotations

import argparse
import email.parser
import email.policy
import html
import json
import os
import secrets
import sys
import threading
import webbrowser
from dataclasses import replace
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlencode, urlparse

from oslo_screener.auth import (
    AuthConfig,
    LoginLimiter,
    clear_session_cookie,
    is_public_path,
    read_session_cookie,
    session_cookie,
)

from oslo_screener.cli import (
    add_common_arguments,
    criteria_from_args,
    settings_from_args,
)
from oslo_screener.config import Settings
from oslo_screener.data import DataSourceError, fetch_universe
from oslo_screener.journal import (
    DEFAULT_JOURNAL_PATH,
    Journal,
    JournalError,
    journal_api_payload,
    journal_from_payload,
    journal_payload,
    load_journal,
    record_trade,
    save_journal,
    set_available_cash,
    update_trade,
    with_available_cash,
)
from oslo_screener.logic import Criteria, screen
from oslo_screener.news import fetch_news
from oslo_screener.premarket import (
    build_premarket_report,
    load_latest_backtest,
    load_report_history,
    save_daily_report,
)
from oslo_screener.pwa import (
    MANIFEST_PATH,
    OFFLINE_PATH,
    SERVICE_WORKER_JS,
    SERVICE_WORKER_PATH,
    icon_for_path,
    manifest_json,
)
from oslo_screener.render import (
    render_dashboard,
    render_journal_page,
    render_login_page,
    render_offline_page,
)
from oslo_screener.serialize import premarket_to_dict, result_to_dict


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


def _form_value(fields: dict[str, list[str]], name: str, default: str = "") -> str:
    values = fields.get(name)
    return values[0] if values else default


def _form_float(fields: dict[str, list[str]], name: str, label: str) -> float:
    raw = _form_value(fields, name).strip().replace(",", ".")
    if not raw:
        raise JournalError(f"{label} mangler.")
    try:
        value = float(raw)
    except ValueError as exc:
        raise JournalError(f"{label} må være et tall.") from exc
    if value != value or value in (float("inf"), float("-inf")):
        raise JournalError(f"{label} må være et endelig tall.")
    return value


def _form_int(fields: dict[str, list[str]], name: str, label: str) -> int:
    raw = _form_value(fields, name).strip()
    if not raw:
        raise JournalError(f"{label} mangler.")
    try:
        return int(raw)
    except ValueError as exc:
        raise JournalError(f"{label} må være et heltall.") from exc


def _safe_next(value: str) -> str:
    """Tillat bare lokal relativ redirect etter POST."""
    candidate = (value or "/").strip()
    if any(ord(char) < 32 or ord(char) == 127 for char in candidate):
        return "/logg#journal"
    parsed = urlparse(candidate)
    if (
        not candidate.startswith("/")
        or candidate.startswith("//")
        or parsed.scheme
        or parsed.netloc
    ):
        return "/logg#journal"
    return candidate


def _with_notice(url: str, key: str, value: str) -> str:
    parsed = urlparse(url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    query.pop("journal_status", None)
    query.pop("journal_error", None)
    query[key] = [value]
    return parsed._replace(query=urlencode(query, doseq=True), fragment="journal").geturl()


def _with_edit(url: str, trade_id: object) -> str:
    parsed = urlparse(url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    query["edit_trade"] = [str(trade_id)]
    return parsed._replace(query=urlencode(query, doseq=True), fragment="journal").geturl()


def _journal_next(query: dict[str, list[str]], path: str = "/") -> str:
    filtered = {
        key: values
        for key, values in query.items()
        if key not in {"journal_status", "journal_error", "edit_trade"}
    }
    suffix = f"?{urlencode(filtered, doseq=True)}" if filtered else ""
    return f"{path}{suffix}#journal"


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

    def _cookie_secure(self) -> bool:
        if self.app.auth is None:
            return False
        forwarded = (self.headers.get("X-Forwarded-Proto") or "").split(",", 1)[0]
        return self.app.auth.cookie_secure or forwarded.strip().lower() == "https"

    def _is_authenticated(self) -> bool:
        auth = self.app.auth
        if auth is None:
            return True
        token = read_session_cookie(self.headers.get("Cookie", ""))
        return bool(token and auth.verify_token(token))

    def _login_location(self, next_url: str) -> str:
        return "/login?" + urlencode({"next": _safe_next(next_url)})

    def _authorize(self, path: str) -> bool:
        if self.app.auth is None or is_public_path(path) or self._is_authenticated():
            return True
        next_url = self.path if self.command == "GET" else "/logg#journal"
        self._redirect(self._login_location(next_url))
        return False

    def _serve_login(self, query: dict[str, list[str]]) -> None:
        if self.app.auth is None:
            self._redirect("/")
            return
        next_url = _safe_next(_form_value(query, "next", "/"))
        if self._is_authenticated():
            self._redirect(next_url)
            return
        page = render_login_page(next_url=next_url)
        self._send(200, "text/html; charset=utf-8", page.encode("utf-8"))

    def _serve_login_error(self, next_url: str, message: str, status: int) -> None:
        page = render_login_page(
            next_url=next_url,
            error=message,
        )
        self._send(status, "text/html; charset=utf-8", page.encode("utf-8"))

    def _handle_login(self) -> None:
        auth = self.app.auth
        if auth is None:
            self._redirect("/")
            return
        fields = self._read_form_fields()
        if fields is None:
            return
        next_url = _safe_next(_form_value(fields, "next", "/"))
        if self._is_authenticated():
            self._redirect(next_url)
            return
        forwarded_for = (self.headers.get("X-Forwarded-For") or "").split(",", 1)[0]
        client = forwarded_for.strip() or self.client_address[0]
        if self.app.login_limiter.blocked(client):
            self._serve_login_error(
                next_url,
                "For mange feilede forsøk. Prøv igjen om noen minutter.",
                429,
            )
            return
        if not auth.verify_password(_form_value(fields, "password")):
            self.app.login_limiter.fail(client)
            self._serve_login_error(next_url, "Feil passord.", 401)
            return
        self.app.login_limiter.reset(client)
        token = auth.issue_token()
        self.send_response(303)
        self.send_header("Location", next_url)
        self.send_header(
            "Set-Cookie",
            session_cookie(
                token,
                secure=self._cookie_secure(),
                ttl=auth.session_ttl,
            ),
        )
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _handle_logout(self) -> None:
        if self.app.auth is None:
            self._redirect("/")
            return
        self.send_response(303)
        self.send_header("Location", "/login")
        self.send_header(
            "Set-Cookie",
            clear_session_cookie(secure=self._cookie_secure()),
        )
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_form_fields(self) -> Optional[dict[str, list[str]]]:
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            length = 0
        if length <= 0 or length > 65_536:
            self._send(
                413,
                "text/plain; charset=utf-8",
                b"Ugyldig eller for stor foresporsel.\n",
            )
            return None
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type not in {"", "application/x-www-form-urlencoded"}:
            self._send(
                415,
                "text/plain; charset=utf-8",
                b"Bruk et vanlig HTML-skjema.\n",
            )
            return None
        try:
            body = self.rfile.read(length).decode("utf-8")
        except UnicodeDecodeError:
            self._send(
                400,
                "text/plain; charset=utf-8",
                b"Foresporselen maa vaere UTF-8.\n",
            )
            return None
        return parse_qs(body, keep_blank_values=True)

    def _read_request_body(self, max_length: int) -> Optional[bytes]:
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            length = 0
        if length <= 0 or length > max_length:
            self._send(
                413,
                "text/plain; charset=utf-8",
                b"Ugyldig eller for stor fil.\n",
            )
            return None
        try:
            return self.rfile.read(length)
        except OSError:
            self._send(
                400,
                "text/plain; charset=utf-8",
                b"Kunne ikke lese opplastingen.\n",
            )
            return None

    def _multipart_file(self, body: bytes, content_type: str) -> bytes:
        header = (
            f"Content-Type: {content_type}\r\n"
            "MIME-Version: 1.0\r\n\r\n"
        ).encode("latin-1")
        try:
            message = email.parser.BytesParser(
                policy=email.policy.default
            ).parsebytes(header + body)
        except Exception as exc:  # pragma: no cover - defensive parser guard
            raise JournalError(f"Kunne ikke lese filopplastingen: {exc}") from exc
        if not message.is_multipart():
            raise JournalError("Filopplastingen mangler en multipart-boundary.")
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue
            name = part.get_param("name", header="content-disposition")
            if name not in {"journal_file", "file", "journal"}:
                continue
            payload = part.get_payload(decode=True)
            if payload is not None:
                return payload
        raise JournalError("Fant ingen dagbokfil i opplastingen.")

    def _serve_journal_export(self) -> None:
        journal, error = self._load_journal()
        if journal is None:
            self._redirect(
                _with_notice(
                    "/logg#journal",
                    "journal_error",
                    error or "Dagboken kunne ikke leses.",
                )
            )
            return
        body = (
            json.dumps(
                journal_payload(journal),
                ensure_ascii=False,
                indent=2,
            )
            + "\n"
        ).encode("utf-8")
        filename = (
            "tollbugata-journal-"
            + datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
            + ".json"
        )
        self._send(
            200,
            "application/json; charset=utf-8",
            body,
            extra_headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    def _handle_journal_import(self) -> None:
        body = self._read_request_body(2_000_000)
        if body is None:
            return
        content_type = self.headers.get("Content-Type", "")
        mime = content_type.split(";", 1)[0].strip().lower()
        try:
            if mime == "multipart/form-data":
                raw = self._multipart_file(body, content_type)
            elif mime in {"application/json", "text/plain", ""}:
                raw = body
            else:
                self._send(
                    415,
                    "text/plain; charset=utf-8",
                    b"Last opp en JSON-fil eller send application/json.\n",
                )
                return
            data = json.loads(raw.decode("utf-8"))
            journal = journal_from_payload(
                data,
                default_cash=self.app.settings.trade.capital,
            )
            with self.app.journal_lock:
                save_journal(journal, self.app.journal_path)
        except (UnicodeDecodeError, json.JSONDecodeError, JournalError, OSError) as exc:
            self._redirect(
                _with_notice(
                    "/logg#journal",
                    "journal_error",
                    f"Import feilet: {exc}",
                )
            )
            return
        self._redirect(
            _with_notice("/logg#journal", "journal_status", "imported")
        )

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler-API)
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query, keep_blank_values=True)

        if not self._authorize(parsed.path):
            return

        try:
            if parsed.path == "/login":
                self._serve_login(query)
            elif parsed.path == "/logout":
                self._redirect("/login")
            elif parsed.path == "/healthz":
                self._send(200, "text/plain; charset=utf-8", b"ok\n")
            elif parsed.path == MANIFEST_PATH:
                self._serve_manifest()
            elif parsed.path == SERVICE_WORKER_PATH:
                self._serve_service_worker()
            elif parsed.path == OFFLINE_PATH:
                self._serve_offline()
            elif parsed.path == "/favicon.ico" or parsed.path.startswith("/icons/"):
                self._serve_icon(parsed.path)
            elif parsed.path == "/api/data":
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
            elif parsed.path == "/journal/export":
                self._serve_journal_export()
            elif parsed.path == "/":
                self._serve_dashboard(query)
            elif parsed.path == "/logg":
                self._serve_journal(query)
            else:
                self._send(
                    404,
                    "text/plain; charset=utf-8",
                    b"Fant ikke siden. Prov /, /logg eller /api/data.\n",
                )
        except DataSourceError as exc:
            self._serve_error(str(exc))

    def do_POST(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler-API)
        parsed = urlparse(self.path)
        if parsed.path == "/login":
            self._handle_login()
            return
        if parsed.path == "/logout":
            self._handle_logout()
            return
        if not self._authorize(parsed.path):
            return
        if parsed.path == "/journal/import":
            self._handle_journal_import()
            return
        if parsed.path not in {
            "/journal/trade",
            "/journal/edit",
            "/journal/cash",
        }:
            self._send(
                404,
                "text/plain; charset=utf-8",
                b"Fant ikke endepunktet. Bruk /journal/trade, /journal/edit "
                b"/journal/cash eller /journal/import.\n",
            )
            return

        fields = self._read_form_fields()
        if fields is None:
            return
        next_url = _safe_next(_form_value(fields, "next", "/#journal"))
        trade_id_value = _form_value(fields, "trade_id")
        try:
            with self.app.journal_lock:
                journal = load_journal(
                    self.app.journal_path,
                    default_cash=self.app.settings.trade.capital,
                )
                if parsed.path == "/journal/trade":
                    journal = record_trade(
                        journal,
                        ticker=_form_value(fields, "ticker"),
                        side=_form_value(fields, "side"),
                        quantity=_form_int(fields, "quantity", "Antall aksjer"),
                        price=_form_float(fields, "price", "Kurs"),
                        fee=_form_float(fields, "fee", "Kurtasje")
                        if _form_value(fields, "fee").strip()
                        else 0.0,
                        note=_form_value(fields, "note"),
                        executed_at=_form_value(fields, "executed_at") or None,
                    )
                    status = "trade"
                elif parsed.path == "/journal/edit":
                    journal = update_trade(
                        journal,
                        _form_int(fields, "trade_id", "Handels-ID"),
                        ticker=_form_value(fields, "ticker"),
                        side=_form_value(fields, "side"),
                        quantity=_form_int(fields, "quantity", "Antall aksjer"),
                        price=_form_float(fields, "price", "Kurs"),
                        fee=_form_float(fields, "fee", "Kurtasje")
                        if _form_value(fields, "fee").strip()
                        else 0.0,
                        note=_form_value(fields, "note"),
                        executed_at=_form_value(fields, "executed_at") or None,
                    )
                    status = "edited"
                else:
                    journal = set_available_cash(
                        journal,
                        amount=_form_float(fields, "amount", "Ledig kapital"),
                        note=_form_value(fields, "note"),
                    )
                    status = "cash"
                save_journal(journal, self.app.journal_path)
        except JournalError as exc:
            if parsed.path == "/journal/edit" and trade_id_value:
                next_url = _with_edit(next_url, trade_id_value)
            self._redirect(_with_notice(next_url, "journal_error", str(exc)))
            return
        except OSError as exc:
            if parsed.path == "/journal/edit" and trade_id_value:
                next_url = _with_edit(next_url, trade_id_value)
            self._redirect(
                _with_notice(
                    next_url,
                    "journal_error",
                    f"Kunne ikke lagre dagboken: {exc}",
                )
            )
            return
        self._redirect(_with_notice(next_url, "journal_status", status))

    def _load_journal(self) -> tuple[Optional[Journal], Optional[str]]:
        try:
            with self.app.journal_lock:
                return (
                    load_journal(
                        self.app.journal_path,
                        default_cash=self.app.settings.trade.capital,
                    ),
                    None,
                )
        except JournalError as exc:
            return None, str(exc)

    def _redirect(self, location: str) -> None:
        self.send_response(303)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _serve_dashboard(self, query: dict[str, list[str]]) -> None:
        base_query = {
            key: values
            for key, values in query.items()
            if key not in {"journal_status", "journal_error", "edit_trade"}
        }
        criteria = criteria_from_query(base_query, self.app.defaults)
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
        journal, _ = self._load_journal()
        report_settings = (
            with_available_cash(self.app.settings, journal.available_cash)
            if journal is not None
            else self.app.settings
        )
        refresh_url = "/refresh"
        if base_query:
            refresh_url += "?" + urlencode(base_query, doseq=True)
        report = build_premarket_report(
            result.matches,
            criteria,
            universe,
            news=news,
            settings=report_settings,
        )
        save_daily_report(report, news=news)
        page = render_dashboard(
            result,
            universe,
            criteria,
            sort_by=self.app.sort_by,
            web_mode=True,
            refresh_url=refresh_url,
            news=news,
            report=report,
            auth_enabled=self.app.auth is not None,
        )
        self._send(200, "text/html; charset=utf-8", page.encode("utf-8"))

    def _serve_journal(self, query: dict[str, list[str]]) -> None:
        base_query = {
            key: values
            for key, values in query.items()
            if key not in {"journal_status", "journal_error", "edit_trade"}
        }
        journal, journal_load_error = self._load_journal()
        journal_status = _form_value(query, "journal_status")
        journal_error = _form_value(query, "journal_error") or journal_load_error
        edit_trade_id: Optional[int] = None
        edit_value = _form_value(query, "edit_trade").strip()
        if edit_value:
            try:
                edit_trade_id = int(edit_value)
            except ValueError:
                journal_error = journal_error or "Ugyldig handels-ID for redigering."
        page = render_journal_page(
            journal,
            status=journal_status,
            error=journal_error,
            next_url=_journal_next(base_query, "/logg"),
            buy_fee=self.app.settings.trade.buy_fee,
            sell_fee=self.app.settings.trade.sell_fee,
            edit_trade_id=edit_trade_id,
            backtest=load_latest_backtest(),
            history=load_report_history(),
            auth_enabled=self.app.auth is not None,
        )
        self._send(200, "text/html; charset=utf-8", page.encode("utf-8"))

    def _serve_manifest(self) -> None:
        self._send(
            200,
            "application/manifest+json; charset=utf-8",
            manifest_json(),
            cache_control="public, max-age=3600",
        )

    def _serve_service_worker(self) -> None:
        self._send(
            200,
            "text/javascript; charset=utf-8",
            SERVICE_WORKER_JS.encode("utf-8"),
            cache_control="no-cache, no-store, must-revalidate",
            extra_headers={"Service-Worker-Allowed": "/"},
        )

    def _serve_offline(self) -> None:
        self._send(
            200,
            "text/html; charset=utf-8",
            render_offline_page().encode("utf-8"),
            cache_control="public, max-age=3600",
        )

    def _serve_icon(self, path: str) -> None:
        icon = icon_for_path(path)
        if icon is None:
            self._send(
                404,
                "text/plain; charset=utf-8",
                b"Fant ikke ikonet.\n",
            )
            return
        body, _size = icon
        self._send(
            200,
            "image/png",
            body,
            cache_control="public, max-age=86400",
        )

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
        journal, journal_error = self._load_journal()
        report_settings = (
            with_available_cash(self.app.settings, journal.available_cash)
            if journal is not None
            else self.app.settings
        )
        report = build_premarket_report(
            result.matches,
            criteria,
            universe,
            news=news,
            settings=report_settings,
        )
        payload = result_to_dict(
            result,
            universe,
            criteria,
            sort_by=self.app.sort_by,
            news=news,
            premarket=premarket_to_dict(report, news=news),
            settings=report_settings,
        )
        payload["journal"] = (
            journal_api_payload(journal)
            if journal is not None
            else {"error": journal_error or "Dagboken kunne ikke leses."}
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

    def _send(
        self,
        status: int,
        content_type: str,
        body: bytes,
        *,
        cache_control: str = "no-store",
        extra_headers: Optional[dict[str, str]] = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; "
            "script-src 'self' 'unsafe-inline'; img-src 'self' data:; "
            "manifest-src 'self'; worker-src 'self'; connect-src 'self'; "
            "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        )
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
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
        settings: Optional[Settings] = None,
        journal_path: str | Path = DEFAULT_JOURNAL_PATH,
        auth: Optional[AuthConfig] = None,
        login_limiter: Optional[LoginLimiter] = None,
    ) -> None:
        self.defaults = defaults
        self.cache_ttl = cache_ttl
        self.http_timeout = http_timeout
        self.sort_by = sort_by
        self.include_news = include_news
        self.settings = settings or Settings()
        self.journal_path = Path(journal_path)
        self.journal_lock = threading.Lock()
        self.auth = auth
        self.login_limiter = login_limiter or LoginLimiter()
        super().__init__(server_address, ScreenerHandler)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="app.py",
        description="Lokal webapp med pre-market-rapport for Oslo Børs.",
    )
    add_common_arguments(parser)
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help=(
            "lytteadresse (standard: 127.0.0.1). Bruk 0.0.0.0 for å nå appen "
            "fra mobil på samme nett"
        ),
    )
    try:
        default_port = int(os.environ.get("PORT", "8501"))
    except ValueError:
        default_port = 8501
    parser.add_argument(
        "--port",
        type=int,
        default=default_port,
        help=f"port (standard: {default_port}, eller PORT-miljøvariabelen)",
    )
    parser.add_argument(
        "--journal",
        default=os.environ.get("TP_JOURNAL", str(DEFAULT_JOURNAL_PATH)),
        help=(
            "sti til lokal handelsdagbok (standard: TP_JOURNAL eller "
            f"{DEFAULT_JOURNAL_PATH})"
        ),
    )
    parser.add_argument(
        "--auth-password",
        default=os.environ.get("TP_PASSWORD", ""),
        help=(
            "passord for innlogging. Tom verdi slår av innlogging. "
            "Kan også settes med TP_PASSWORD"
        ),
    )
    parser.add_argument(
        "--auth-secret",
        default=os.environ.get("TP_SECRET", ""),
        help=(
            "hemmelighet for signerte sesjonskaker. Kan også settes med TP_SECRET. "
            "Uten verdi lages en tilfeldig hemmelighet ved oppstart"
        ),
    )
    parser.add_argument(
        "--secure-cookies",
        action="store_true",
        default=os.environ.get("TP_SECURE_COOKIES", "").lower()
        in {"1", "true", "yes", "on"},
        help="merk innloggingskaken som Secure (kreves normalt bak HTTPS)",
    )
    parser.add_argument("--no-browser", action="store_true", help="åpne ikke nettleseren automatisk")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        defaults = criteria_from_args(args)
        settings = settings_from_args(args)
    except ValueError as exc:
        print(f"Feil i konfigurasjonen: {exc}", file=sys.stderr)
        return 1

    auth: Optional[AuthConfig] = None
    if args.auth_password:
        secret = args.auth_secret or secrets.token_urlsafe(32)
        if not args.auth_secret:
            print(
                "Advarsel: TP_SECRET er ikke satt. Innloggingen virker, men alle "
                "sesjoner blir ugyldige når appen starter på nytt.",
                file=sys.stderr,
            )
        try:
            auth = AuthConfig(
                password=args.auth_password,
                secret=secret,
                cookie_secure=args.secure_cookies,
            )
        except ValueError as exc:
            print(f"Feil i innloggingsoppsettet: {exc}", file=sys.stderr)
            return 1
    elif args.host not in {"127.0.0.1", "localhost", "::1"}:
        print(
            "Advarsel: appen er tilgjengelig uten passord. Bruk TP_PASSWORD "
            "eller --auth-password når den ikke bare kjører lokalt.",
            file=sys.stderr,
        )

    try:
        server = ScreenerHTTPServer(
            (args.host, args.port),
            defaults=defaults,
            cache_ttl=args.cache_ttl,
            http_timeout=args.timeout,
            sort_by=args.sort,
            include_news=not args.no_news,
            settings=settings,
            journal_path=args.journal,
            auth=auth,
        )
    except OSError as exc:
        print(f"Kunne ikke starte på {args.host}:{args.port}: {exc}", file=sys.stderr)
        return 1

    display_host = "127.0.0.1" if args.host in ("0.0.0.0", "::", "") else args.host
    url = f"http://{display_host}:{args.port}/"
    print(f"Tollbugata Profits kjører på {url}")
    if args.host in ("0.0.0.0", "::", ""):
        print(
            f"Mobil: åpne http://<datamaskinens-IP>:{args.port}/ i Chrome "
            "og velg «Legg til på startskjermen»."
        )
        print(
            "Mobilmodusen bruker samme server, samme logikk og samme dagbok "
            "som desktop."
        )
    print(f"Lokal handelsdagbok: {Path(args.journal)}")
    print(f"Passordbeskyttelse: {'på' if auth is not None else 'av'}")
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
