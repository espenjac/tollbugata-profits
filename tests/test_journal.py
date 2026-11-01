"""Tester for lokal handelsdagbok, saldo og HTTP-skjema."""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlparse

from app import ScreenerHTTPServer
from oslo_screener.config import Settings
from oslo_screener.data import Universe
from oslo_screener.journal import (
    JournalError,
    journal_api_payload,
    journal_from_payload,
    journal_payload,
    load_journal,
    record_trade,
    save_journal,
    set_available_cash,
    summarize_journal,
    update_trade,
    with_available_cash,
)
from oslo_screener.logic import Criteria, screen
from oslo_screener.models import Stock
from oslo_screener.render import render_dashboard, render_journal_page


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


class JournalTests(unittest.TestCase):
    def test_missing_journal_uses_default_cash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            journal = load_journal(Path(directory) / "journal.json", default_cash=5000)
        self.assertEqual(journal.available_cash, 5000.0)
        self.assertEqual(journal.trades, ())

    def test_buy_reduces_cash_and_keeps_whole_shares(self) -> None:
        journal = load_journal(Path("/does/not/exist"), default_cash=5000)
        journal = record_trade(
            journal,
            ticker="eqnr",
            side="buy",
            quantity=49,
            price=100.0,
            fee=29.0,
            note="første kjøp",
        )
        self.assertEqual(journal.available_cash, 71.0)
        self.assertEqual(journal.trades[0].ticker, "EQNR")
        self.assertEqual(journal.trades[0].cash_change, -4929.0)
        summary = summarize_journal(journal)
        self.assertEqual(summary.holdings[0].quantity, 49)
        self.assertEqual(summary.holdings[0].cost_basis, 4929.0)
        self.assertEqual(summary.realized_profit, 0.0)
        self.assertEqual(summary.total_fees, 29.0)

    def test_buy_rejects_fractional_shares(self) -> None:
        journal = load_journal(Path("/does/not/exist"), default_cash=5000)
        with self.assertRaises(JournalError):
            record_trade(
                journal,
                ticker="EQNR",
                side="buy",
                quantity=49.5,  # type: ignore[arg-type]
                price=100.0,
                fee=29.0,
            )

    def test_buy_rejects_insufficient_cash(self) -> None:
        journal = load_journal(Path("/does/not/exist"), default_cash=5000)
        with self.assertRaises(JournalError):
            record_trade(
                journal,
                ticker="EQNR",
                side="buy",
                quantity=50,
                price=100.0,
                fee=29.0,
            )

    def test_sell_updates_cash_and_realized_profit(self) -> None:
        journal = load_journal(Path("/does/not/exist"), default_cash=5000)
        journal = record_trade(
            journal,
            ticker="EQNR",
            side="buy",
            quantity=49,
            price=100.0,
            fee=29.0,
        )
        journal = record_trade(
            journal,
            ticker="EQNR",
            side="sell",
            quantity=49,
            price=102.0,
            fee=29.0,
        )
        self.assertEqual(journal.available_cash, 5040.0)
        summary = summarize_journal(journal)
        self.assertEqual(summary.holdings, ())
        self.assertEqual(summary.realized_profit, 40.0)
        self.assertEqual(summary.total_fees, 58.0)

    def test_manual_cash_update_is_logged_and_persisted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.json"
            journal = load_journal(path, default_cash=5000)
            journal = set_available_cash(journal, 7500.0, note="innskudd")
            save_journal(journal, path)
            loaded = load_journal(path, default_cash=5000)
            self.assertEqual(loaded.available_cash, 7500.0)
            self.assertEqual(len(loaded.adjustments), 1)
            self.assertEqual(loaded.adjustments[0].difference, 2500.0)
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["available_cash"], 7500.0)

    def test_load_repairs_next_id_after_manual_edit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.json"
            journal = load_journal(path, default_cash=5000)
            journal = record_trade(
                journal,
                ticker="EQNR",
                side="buy",
                quantity=1,
                price=100.0,
                fee=0.0,
            )
            payload = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
            self.assertIsNone(payload)
            save_journal(journal, path)
            data = json.loads(path.read_text(encoding="utf-8"))
            data["next_id"] = 1
            path.write_text(json.dumps(data), encoding="utf-8")
            loaded = load_journal(path, default_cash=5000)
            self.assertEqual(loaded.next_id, 2)

    def test_corrupt_file_raises_clear_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.json"
            path.write_text("{", encoding="utf-8")
            with self.assertRaises(JournalError):
                load_journal(path, default_cash=5000)

    def test_update_trade_adjusts_cash_and_marks_edited(self) -> None:
        journal = load_journal(Path("/does/not/exist"), default_cash=5000)
        journal = record_trade(
            journal,
            ticker="EQNR",
            side="buy",
            quantity=10,
            price=100.0,
            fee=29.0,
            note="feil kurs",
        )
        registered_at = journal.trades[0].registered_at
        updated = update_trade(
            journal,
            1,
            ticker="EQNR",
            side="buy",
            quantity=10,
            price=90.0,
            fee=29.0,
            note="rettet kurs",
        )
        self.assertEqual(updated.available_cash, 4071.0)
        self.assertEqual(updated.next_id, 2)
        self.assertEqual(updated.trades[0].price, 90.0)
        self.assertEqual(updated.trades[0].cash_change, -929.0)
        self.assertEqual(updated.trades[0].note, "rettet kurs")
        self.assertEqual(updated.trades[0].registered_at, registered_at)
        self.assertIsNotNone(updated.trades[0].edited_at)
        self.assertEqual(
            journal_api_payload(updated)["trades"][0]["edited_at"],
            updated.trades[0].edited_at.isoformat(),
        )

    def test_update_trade_rejects_negative_cash(self) -> None:
        journal = load_journal(Path("/does/not/exist"), default_cash=1000)
        journal = record_trade(
            journal,
            ticker="EQNR",
            side="buy",
            quantity=9,
            price=100.0,
            fee=29.0,
        )
        with self.assertRaisesRegex(JournalError, "negativ ledig kapital"):
            update_trade(
                journal,
                1,
                ticker="EQNR",
                side="buy",
                quantity=9,
                price=200.0,
                fee=29.0,
            )

    def test_update_trade_rejects_unknown_id(self) -> None:
        journal = load_journal(Path("/does/not/exist"), default_cash=5000)
        with self.assertRaisesRegex(JournalError, "Fant ikke handel"):
            update_trade(
                journal,
                99,
                ticker="EQNR",
                side="buy",
                quantity=1,
                price=100.0,
                fee=29.0,
            )

    def test_cash_override_is_used_by_settings(self) -> None:
        settings = with_available_cash(Settings(), 2500.0)
        self.assertEqual(settings.trade.capital, 2500.0)
        self.assertEqual(Settings().trade.capital, 5000.0)

    def test_api_payload_contains_summary_and_trades(self) -> None:
        journal = load_journal(Path("/does/not/exist"), default_cash=5000)
        journal = record_trade(
            journal,
            ticker="EQNR",
            side="buy",
            quantity=10,
            price=100.0,
            fee=29.0,
        )
        payload = journal_api_payload(journal)
        self.assertEqual(payload["available_cash"], 3971.0)
        self.assertEqual(payload["trades"][0]["ticker"], "EQNR")
        self.assertEqual(payload["holdings"][0]["quantity"], 10)

    def test_dashboard_has_tabs_and_does_not_render_journal(self) -> None:
        stock = make_stock()
        result = screen([stock], Criteria())
        page = render_dashboard(result, make_universe([stock]), Criteria())
        self.assertIn('href="/"', page)
        self.assertIn('href="/logg"', page)
        self.assertIn("Kursinformasjon", page)
        self.assertIn("Handelsdagbok", page)
        self.assertNotIn("Handelsdagbok og ledig kapital", page)
        self.assertNotIn('action="/journal/trade"', page)
        self.assertNotIn("Historisk test", page)
        self.assertNotIn("Tidligere morgenrapporter", page)

    def test_journal_page_renders_forms_and_balance(self) -> None:
        journal = load_journal(Path("/does/not/exist"), default_cash=5000)
        page = render_journal_page(journal, next_url="/logg#journal")
        self.assertIn("Handelsdagbok og ledig kapital", page)
        self.assertIn('action="/journal/trade"', page)
        self.assertIn('action="/journal/cash"', page)
        self.assertIn("5 000 kr", page)
        self.assertIn("ingen ordrer sendes", page.lower())
        self.assertIn('href="/logg"', page)
        self.assertIn('aria-current="page"', page)

    def test_journal_page_renders_quick_sell_and_edit_form(self) -> None:
        journal = load_journal(Path("/does/not/exist"), default_cash=5000)
        journal = record_trade(
            journal,
            ticker="EQNR",
            side="buy",
            quantity=10,
            price=100.0,
            fee=29.0,
        )
        page = render_journal_page(
            journal,
            next_url="/logg#journal",
            edit_trade_id=1,
        )
        self.assertIn("Rediger handel #1", page)
        self.assertIn('action="/journal/edit"', page)
        self.assertIn('name="trade_id" value="1"', page)
        self.assertIn('value="100.0000"', page)
        self.assertIn("Selg alt · EQNR (10 aksjer)", page)
        self.assertIn('name="side" value="sell"', page)
        self.assertIn('name="quantity" value="10"', page)
        self.assertIn("edit_trade=1", page)


class JournalHTTPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.journal_path = Path(self.directory.name) / "journal.json"
        self.server = ScreenerHTTPServer(
            ("127.0.0.1", 0),
            defaults=Criteria(),
            cache_ttl=60,
            http_timeout=1.0,
            sort_by="week",
            include_news=False,
            settings=Settings(),
            journal_path=self.journal_path,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.directory.cleanup()

    def _post(self, path: str, data: dict[str, object]) -> tuple[int, str]:
        connection = HTTPConnection(
            "127.0.0.1", self.server.server_address[1], timeout=3
        )
        body = urlencode(data)
        connection.request(
            "POST",
            path,
            body=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response = connection.getresponse()
        response.read()
        location = response.getheader("Location", "")
        connection.close()
        return response.status, location

    def _post_multipart(
        self,
        path: str,
        filename: str,
        data: bytes,
    ) -> tuple[int, str]:
        boundary = "----tollbugata-test-boundary"
        body = (
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="journal_file"; '
                f'filename="{filename}"\r\n'
                "Content-Type: application/json\r\n\r\n"
            ).encode("utf-8")
            + data
            + f"\r\n--{boundary}--\r\n".encode("utf-8")
        )
        connection = HTTPConnection(
            "127.0.0.1", self.server.server_address[1], timeout=3
        )
        connection.request(
            "POST",
            path,
            body=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        response = connection.getresponse()
        response.read()
        location = response.getheader("Location", "")
        connection.close()
        return response.status, location

    def test_http_cash_update_persists(self) -> None:
        status, location = self._post(
            "/journal/cash",
            {"amount": "7500", "note": "innskudd", "next": "/logg#journal"},
        )
        self.assertEqual(status, 303)
        self.assertIn("journal_status=cash", location)
        self.assertEqual(load_journal(self.journal_path).available_cash, 7500.0)

    def test_http_trade_updates_cash_and_rejects_bad_input(self) -> None:
        status, location = self._post(
            "/journal/trade",
            {
                "ticker": "EQNR",
                "side": "buy",
                "quantity": "49",
                "price": "100",
                "fee": "29",
                "note": "test",
                "next": "/logg#journal",
            },
        )
        self.assertEqual(status, 303)
        self.assertIn("journal_status=trade", location)
        self.assertEqual(load_journal(self.journal_path).available_cash, 71.0)

        status, location = self._post(
            "/journal/trade",
            {
                "ticker": "EQNR",
                "side": "sell",
                "quantity": "49.5",
                "price": "102",
                "fee": "29",
                "next": "/logg#journal",
            },
        )
        self.assertEqual(status, 303)
        query = parse_qs(urlparse(location).query)
        self.assertIn("journal_error", query)
        self.assertEqual(load_journal(self.journal_path).available_cash, 71.0)

    def test_http_edit_updates_trade_and_cash(self) -> None:
        self._post(
            "/journal/trade",
            {
                "ticker": "EQNR",
                "side": "buy",
                "quantity": "10",
                "price": "100",
                "fee": "29",
                "next": "/logg#journal",
            },
        )
        status, location = self._post(
            "/journal/edit",
            {
                "trade_id": "1",
                "ticker": "EQNR",
                "side": "buy",
                "quantity": "10",
                "price": "90",
                "fee": "29",
                "note": "rettet kurs",
                "next": "/logg#journal",
            },
        )
        self.assertEqual(status, 303)
        query = parse_qs(urlparse(location).query)
        self.assertEqual(query["journal_status"], ["edited"])
        self.assertNotIn("edit_trade", query)
        loaded = load_journal(self.journal_path)
        self.assertEqual(loaded.available_cash, 4071.0)
        self.assertEqual(loaded.trades[0].price, 90.0)
        self.assertIsNotNone(loaded.trades[0].edited_at)

    def test_http_edit_error_returns_to_edit_form(self) -> None:
        self._post(
            "/journal/trade",
            {
                "ticker": "EQNR",
                "side": "buy",
                "quantity": "9",
                "price": "100",
                "fee": "29",
                "next": "/logg#journal",
            },
        )
        status, location = self._post(
            "/journal/edit",
            {
                "trade_id": "1",
                "ticker": "EQNR",
                "side": "buy",
                "quantity": "9",
                "price": "1000",
                "fee": "29",
                "next": "/logg#journal",
            },
        )
        self.assertEqual(status, 303)
        query = parse_qs(urlparse(location).query)
        self.assertEqual(query["edit_trade"], ["1"])
        self.assertIn("journal_error", query)
        self.assertEqual(load_journal(self.journal_path).trades[0].price, 100.0)

    def test_http_journal_page_uses_journal_cash_without_market_data(self) -> None:
        journal = load_journal(self.journal_path, default_cash=5000)
        journal = set_available_cash(journal, 2500.0, note="test")
        save_journal(journal, self.journal_path)
        connection = HTTPConnection(
            "127.0.0.1", self.server.server_address[1], timeout=3
        )
        history = [
            {
                "generated_at": "2026-10-29T08:15:00+00:00",
                "ticker": "EQNR",
                "name": "Equinor ASA",
                "score": 81.0,
                "risk_score": 34.0,
                "categories": ["momentum"],
            }
        ]
        with patch(
            "app.fetch_universe",
            side_effect=AssertionError("loggfanen skal ikke hente markedsdata"),
        ), patch("app.load_latest_backtest", return_value=None), patch(
            "app.load_report_history", return_value=history
        ):
            connection.request("GET", "/logg")
            response = connection.getresponse()
            page = response.read().decode("utf-8")
        connection.close()
        self.assertEqual(response.status, 200)
        self.assertIn("Handelsdagbok og ledig kapital", page)
        self.assertIn("2 500 kr", page)
        self.assertIn('value="2500.00"', page)
        self.assertIn('aria-current="page"', page)
        self.assertIn("Historisk test", page)
        self.assertIn("Tidligere morgenrapporter", page)
        self.assertIn("EQNR", page)
        self.assertIn('href="/journal/export"', page)
        self.assertIn('action="/journal/import"', page)
        self.assertIn('enctype="multipart/form-data"', page)

    def test_http_journal_export_returns_downloadable_json(self) -> None:
        journal = load_journal(self.journal_path, default_cash=5000)
        journal = set_available_cash(journal, 4_321.0, note="eksport")
        save_journal(journal, self.journal_path)
        connection = HTTPConnection(
            "127.0.0.1", self.server.server_address[1], timeout=3
        )
        connection.request("GET", "/journal/export")
        response = connection.getresponse()
        body = response.read()
        connection.close()
        self.assertEqual(response.status, 200)
        self.assertIn("application/json", response.getheader("Content-Type", ""))
        self.assertIn(
            "attachment",
            response.getheader("Content-Disposition", ""),
        )
        payload = json.loads(body)
        self.assertEqual(payload["available_cash"], 4_321.0)
        self.assertEqual(payload["adjustments"][0]["note"], "eksport")

    def test_http_journal_import_replaces_journal(self) -> None:
        original = load_journal(self.journal_path, default_cash=5000)
        original = set_available_cash(original, 1_000.0, note="gammel")
        save_journal(original, self.journal_path)

        imported = load_journal(Path("/does/not/exist"), default_cash=5000)
        imported = record_trade(
            imported,
            ticker="EQNR",
            side="buy",
            quantity=10,
            price=100.0,
            fee=29.0,
            note="fra telefon",
        )
        raw = json.dumps(journal_payload(imported)).encode("utf-8")
        status, location = self._post_multipart(
            "/journal/import",
            "journal.json",
            raw,
        )
        self.assertEqual(status, 303)
        self.assertIn("journal_status=imported", location)
        loaded = load_journal(self.journal_path)
        self.assertEqual(loaded.available_cash, 3_971.0)
        self.assertEqual(loaded.trades[0].note, "fra telefon")
        self.assertEqual(len(loaded.adjustments), 0)

    def test_http_journal_import_rejects_invalid_json_without_changing_file(self) -> None:
        original = load_journal(self.journal_path, default_cash=5000)
        original = set_available_cash(original, 1_234.0, note="behold")
        save_journal(original, self.journal_path)
        status, location = self._post_multipart(
            "/journal/import",
            "journal.json",
            b"{dette er ikke json}",
        )
        self.assertEqual(status, 303)
        self.assertIn("journal_error", location)
        self.assertEqual(load_journal(self.journal_path).available_cash, 1_234.0)

    def test_journal_from_payload_rejects_wrong_list_types(self) -> None:
        with self.assertRaises(JournalError):
            journal_from_payload({"trades": {}})
        with self.assertRaises(JournalError):
            journal_from_payload({"adjustments": "feil"})

    def test_http_dashboard_has_tabs_and_no_journal(self) -> None:
        stock = make_stock()
        universe = make_universe([stock])
        connection = HTTPConnection(
            "127.0.0.1", self.server.server_address[1], timeout=3
        )
        with patch("app.fetch_universe", return_value=universe), patch(
            "app.save_daily_report"
        ):
            connection.request("GET", "/")
            response = connection.getresponse()
            page = response.read().decode("utf-8")
        connection.close()
        self.assertEqual(response.status, 200)
        self.assertIn('href="/logg"', page)
        self.assertNotIn("Handelsdagbok og ledig kapital", page)

    def test_http_redirect_stays_local(self) -> None:
        status, location = self._post(
            "/journal/cash",
            {"amount": "6000", "next": "https://evil.example/"},
        )
        self.assertEqual(status, 303)
        parsed = urlparse(location)
        self.assertEqual(parsed.netloc, "")
        self.assertEqual(parsed.path, "/logg")
        self.assertEqual(parsed.fragment, "journal")


if __name__ == "__main__":
    unittest.main()
