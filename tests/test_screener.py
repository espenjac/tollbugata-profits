"""Tester for screen-logikk, parsing og visning. Ingen nettverkstilgang."""

from __future__ import annotations

import json
import tempfile
import time
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

from oslo_screener.data import COLUMNS, DataSourceError, fetch_universe, parse_payload
from oslo_screener.formatting import days_until, format_date, format_days_until
from oslo_screener.logic import Criteria, evaluate, is_at_high, screen, sort_stocks
from oslo_screener.markets import (
    GrowthList,
    MarketDataSourceError,
    fetch_growth_tickers,
    parse_growth_payload,
)
from oslo_screener.models import Stock
from oslo_screener.news import (
    NewsSourceError,
    aggregate_sentiment,
    classify_sentiment,
    fetch_news,
    last_market_open,
    news_window_start,
    parse_news_payload,
    unique_news,
)
from oslo_screener.nordnet import nordnet_url
from oslo_screener.render import render_dashboard, render_terminal
from oslo_screener.serialize import result_to_dict, stock_to_dict
from oslo_screener.strategy import is_candidate, rank_candidates


def make_stock(**overrides) -> Stock:
    values = dict(
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
    values.update(overrides)
    return Stock(**values)


def make_payload(**overrides) -> dict:
    values = {column: None for column in COLUMNS}
    values.update(
        {
            "name": "TEST",
            "description": "Test ASA",
            "close": 100.0,
            "currency": "NOK",
            "Perf.W": 3.0,
            "Perf.1M": 8.0,
            "Perf.3M": 15.0,
            "SMA5": 98.0,
            "SMA20": 95.0,
            "SMA50": 90.0,
            "RSI": 58.0,
            "High.All": 120.0,
            "price_52_week_high": 118.0,
            "volume": 12345.0,
            "market_cap_basic": 5_000_000_000.0,
            "sector": "Industrials",
            "exchange": "OSL",
            "type": "stock",
            "typespecs": ["common"],
            "earnings_release_next_date": "2026-11-05",
            "dividend_ex_date_upcoming": "2026-11-13",
        }
    )
    values.update(overrides)
    return {
        "totalCount": 1,
        "data": [{"s": "OSL:TEST", "d": [values[column] for column in COLUMNS]}],
    }


def make_growth_payload(*tickers: str) -> dict:
    """Et minimalt Euronext Growth-svar med tickere i tredje kolonne."""
    names = tickers or ("DVD", "AASB")
    return {
        "iTotalRecords": len(names),
        "aaData": [
            [
                f"{ticker} AS",
                f"NO000000000{index}",
                ticker,
                '<div title="Euronext Growth Oslo">MERK</div>',
            ]
            for index, ticker in enumerate(names)
        ],
    }


def make_growth_list(*tickers: str) -> GrowthList:
    return GrowthList(
        tickers=frozenset(tickers),
        fetched_at=datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc),
        source="cache",
    )


def make_news_payload() -> dict:
    """Et lite NewsWeb-svar med norsk/engelsk duplikat og en gammel melding."""
    return {
        "data": {
            "messages": [
                {
                    "messageId": 1001,
                    "issuerSign": "KOG",
                    "issuerName": "Kongsberg Gruppen ASA",
                    "title": "Meldepliktig handel primærinnsider og nærstående",
                    "publishedTime": "2026-10-29T15:56:24.751Z",
                    "category": [{"category_no": "MELDEPLIKTIG HANDEL"}],
                },
                {
                    "messageId": 1002,
                    "issuerSign": "KOG",
                    "issuerName": "Kongsberg Gruppen ASA",
                    "title": "Mandatory notification of trade of primary insiders",
                    "publishedTime": "2026-10-29T15:56:24.693Z",
                    "category": [{"category_en": "MANDATORY NOTIFICATION OF TRADE"}],
                },
                {
                    "messageId": 1003,
                    "issuerSign": "KOG",
                    "issuerName": "Kongsberg Gruppen ASA",
                    "title": "KONGSBERG inngår avtale om kjøp av egne aksjer",
                    "publishedTime": "2026-10-29T09:00:00.000Z",
                    "category": [{"category_no": "EGNE AKSJER"}],
                },
                {
                    "messageId": 1004,
                    "issuerSign": "EQNR",
                    "issuerName": "Equinor ASA",
                    "title": "Equinor: Ny kontrakt tildelt",
                    "publishedTime": "2026-10-29T08:00:00.000Z",
                    "category": [{"category_no": "KONTRAKT"}],
                },
                {
                    "messageId": 1005,
                    "issuerSign": "DNB",
                    "issuerName": "DNB Bank ASA",
                    "title": "DNB Bank ASA: Kvartalsrapport",
                    "publishedTime": "2026-10-30T06:00:00.000Z",
                    "category": [{"category_no": "HALVÅRSRAPPORT"}],
                },
                {
                    "messageId": 1006,
                    "issuerSign": "OLD",
                    "issuerName": "Gammel ASA",
                    "title": "Gammel melding før siste åpning",
                    "publishedTime": "2026-10-29T07:59:00.000Z",
                    "category": [{"category_no": "ANNET"}],
                },
            ]
        }
    }


class EvaluateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.criteria = Criteria()

    def test_positive_week_passes(self) -> None:
        passed, reason = evaluate(make_stock(), self.criteria)
        self.assertTrue(passed, reason)

    def test_negative_week_fails(self) -> None:
        passed, reason = evaluate(make_stock(week_return=-0.01), self.criteria)
        self.assertFalse(passed)
        self.assertEqual(reason, "svak uke")

    def test_zero_week_is_not_positive(self) -> None:
        passed, _ = evaluate(make_stock(week_return=0.0), self.criteria)
        self.assertFalse(passed)

    def test_missing_week_fails(self) -> None:
        passed, reason = evaluate(make_stock(week_return=None), self.criteria)
        self.assertFalse(passed)
        self.assertEqual(reason, "mangler ukedata")

    def test_below_sma5_fails(self) -> None:
        passed, reason = evaluate(make_stock(close=97.0), self.criteria)
        self.assertFalse(passed)
        self.assertEqual(reason, "under SMA5")

    def test_sma5_filter_can_be_disabled(self) -> None:
        criteria = Criteria(require_above_sma5=False)
        passed, reason = evaluate(make_stock(close=97.0), criteria)
        self.assertTrue(passed, reason)

    def test_below_sma20_fails_when_enabled(self) -> None:
        criteria = Criteria(require_above_sma20=True)
        passed, reason = evaluate(make_stock(close=96.0, sma5=94.0, sma20=98.0), criteria)
        self.assertFalse(passed)
        self.assertEqual(reason, "under SMA20")

    def test_near_ath_is_included_and_flagged_by_default(self) -> None:
        # 109,5 er innenfor 1 % av ATH på 110, men skal nå tas med og flagges.
        stock = make_stock(close=109.5)
        passed, reason = evaluate(stock, self.criteria)
        self.assertTrue(passed, reason)
        self.assertTrue(is_at_high(stock, self.criteria))

    def test_near_ath_fails_when_excluded(self) -> None:
        stock = make_stock(close=109.5)
        passed, reason = evaluate(stock, Criteria(include_at_high=False))
        self.assertFalse(passed)
        self.assertEqual(reason, "på/ved ATH")

    def test_exactly_at_ath_is_included_by_default(self) -> None:
        stock = make_stock(close=110.0)
        passed, reason = evaluate(stock, self.criteria)
        self.assertTrue(passed, reason)
        self.assertTrue(is_at_high(stock, self.criteria))

    def test_above_ath_is_included_by_default(self) -> None:
        stock = make_stock(close=115.0, ath=110.0, high_52w=110.0)
        passed, reason = evaluate(stock, self.criteria)
        self.assertTrue(passed, reason)
        self.assertTrue(is_at_high(stock, self.criteria))

    def test_far_below_ath_passes(self) -> None:
        passed, reason = evaluate(make_stock(close=100.0, ath=150.0, high_52w=150.0), self.criteria)
        self.assertTrue(passed, reason)

    def test_ath_margin_is_configurable(self) -> None:
        # 1,4 % under ATH: passerer med 1 % margin, feiler med 2 % når ATH skjules.
        stock = make_stock(close=108.5, ath=110.0)
        self.assertTrue(
            evaluate(stock, Criteria(ath_margin=0.01, include_at_high=False))[0]
        )
        self.assertFalse(
            evaluate(stock, Criteria(ath_margin=0.02, include_at_high=False))[0]
        )
        self.assertFalse(is_at_high(stock, Criteria(ath_margin=0.01)))
        self.assertTrue(is_at_high(stock, Criteria(ath_margin=0.02)))

    def test_distorted_ath_near_52w_is_rejected(self) -> None:
        # ATH ser ut som en splittfeil (5 mill. mot 52-ukershøyeste 110).
        stock = make_stock(close=109.0, ath=5_000_000.0, high_52w=110.0)
        passed, reason = evaluate(stock, self.criteria)
        self.assertFalse(passed)
        self.assertEqual(reason, "ATH usikker")

    def test_distorted_ath_well_below_52w_passes(self) -> None:
        stock = make_stock(close=100.0, ath=5_000_000.0, high_52w=110.0)
        passed, reason = evaluate(stock, self.criteria)
        self.assertTrue(passed, reason)

    def test_missing_ath_but_below_52w_passes(self) -> None:
        # ATH må være minst like høyt som 52-ukershøyeste, så dette er beviselig ikke ATH.
        stock = make_stock(close=100.0, ath=None, high_52w=110.0)
        passed, reason = evaluate(stock, self.criteria)
        self.assertTrue(passed, reason)

    def test_missing_ath_near_52w_is_rejected(self) -> None:
        stock = make_stock(close=109.5, ath=None, high_52w=110.0)
        passed, reason = evaluate(stock, self.criteria)
        self.assertFalse(passed)
        self.assertEqual(reason, "ukjent ATH")

    def test_allow_unknown_ath(self) -> None:
        stock = make_stock(close=109.5, ath=None, high_52w=110.0)
        passed, reason = evaluate(stock, Criteria(allow_unknown_ath=True))
        self.assertTrue(passed, reason)

    def test_market_cap_filter(self) -> None:
        stock = make_stock(market_cap=500_000_000.0)
        passed, reason = evaluate(stock, Criteria(min_market_cap=1_000_000_000.0))
        self.assertFalse(passed)
        self.assertEqual(reason, "for lav markedsverdi")

    def test_turnover_filter(self) -> None:
        stock = make_stock(volume=100.0, close=100.0)  # 10 000 omsatt
        passed, reason = evaluate(stock, Criteria(min_turnover=1_000_000.0))
        self.assertFalse(passed)
        self.assertEqual(reason, "for lavt omsetningsvolum")

    def test_instrument_type_filter(self) -> None:
        stock = make_stock(instrument_type="dr")
        passed, reason = evaluate(stock, Criteria(include_types=("stock",)))
        self.assertFalse(passed)
        self.assertEqual(reason, "ikke aksje")

    def test_growth_is_excluded_by_default(self) -> None:
        stock = make_stock(market="euronext_growth")
        passed, reason = evaluate(stock, Criteria())
        self.assertFalse(passed)
        self.assertEqual(reason, "euronext growth")

    def test_growth_can_be_included(self) -> None:
        stock = make_stock(market="euronext_growth")
        passed, reason = evaluate(stock, Criteria(exclude_growth=False))
        self.assertTrue(passed, reason)


class ScreenAndSortTests(unittest.TestCase):
    def test_screen_counts_and_reasons(self) -> None:
        stocks = [
            make_stock(ticker="A"),
            make_stock(ticker="B", week_return=-0.02),
            make_stock(ticker="C", close=97.0),
        ]
        result = screen(stocks, Criteria())
        self.assertEqual(result.universe_size, 3)
        self.assertEqual(result.match_count, 1)
        self.assertEqual(result.at_high_count, 0)
        self.assertEqual(result.excluded["svak uke"], 1)
        self.assertEqual(result.excluded["under SMA5"], 1)

    def test_screen_counts_at_high(self) -> None:
        stocks = [
            make_stock(ticker="A"),
            make_stock(ticker="B", close=110.0),
            make_stock(ticker="C", close=109.5),
        ]
        result = screen(stocks, Criteria())
        self.assertEqual(result.match_count, 3)
        self.assertEqual(result.at_high_count, 2)

    def test_screen_excludes_growth(self) -> None:
        stocks = [
            make_stock(ticker="MAIN"),
            make_stock(ticker="GROW", market="euronext_growth"),
        ]
        result = screen(stocks, Criteria())
        self.assertEqual([stock.ticker for stock in result.matches], ["MAIN"])
        self.assertEqual(result.excluded["euronext growth"], 1)

    def test_sort_week_desc_with_missing_last(self) -> None:
        stocks = [
            make_stock(ticker="A", week_return=0.01),
            make_stock(ticker="B", week_return=None),
            make_stock(ticker="C", week_return=0.05),
        ]
        sorted_stocks = sort_stocks(stocks, "week")
        self.assertEqual([s.ticker for s in sorted_stocks], ["C", "A", "B"])

    def test_sort_name(self) -> None:
        stocks = [
            make_stock(ticker="B", name="Beta"),
            make_stock(ticker="A", name="alfa"),
            make_stock(ticker="C", name="Charlie"),
        ]
        sorted_stocks = sort_stocks(stocks, "name")
        self.assertEqual([s.ticker for s in sorted_stocks], ["A", "B", "C"])

    def test_sort_unknown_field_raises(self) -> None:
        with self.assertRaises(ValueError):
            sort_stocks([make_stock()], "noe-rart")


class StrategyTests(unittest.TestCase):
    def test_healthy_momentum_is_a_candidate(self) -> None:
        ranked = rank_candidates([make_stock()])
        self.assertEqual(len(ranked), 1)
        self.assertGreater(ranked[0].score, 0.0)
        self.assertLessEqual(ranked[0].score, 100.0)
        self.assertIn("Uke +2,0 %", ranked[0].reasons)

    def test_excludes_weak_trend(self) -> None:
        stock = make_stock(close=94.0, sma5=90.0, sma20=95.0)
        self.assertFalse(is_candidate(stock))
        self.assertEqual(rank_candidates([stock]), [])

    def test_excludes_negative_month(self) -> None:
        self.assertFalse(is_candidate(make_stock(month_return=-0.01)))

    def test_excludes_illiquid_stock(self) -> None:
        # 10 000 aksjer × 100 kr = 1 mill. kroner i snitt per dag.
        self.assertFalse(is_candidate(make_stock(average_volume_10d=10_000.0)))

    def test_excludes_overextended_week(self) -> None:
        self.assertFalse(is_candidate(make_stock(week_return=0.30)))

    def test_liquidity_breaks_tie(self) -> None:
        liquid = make_stock(
            ticker="LIQ",
            week_return=0.05,
            average_volume_10d=2_000_000.0,
        )
        thin = make_stock(
            ticker="THIN",
            week_return=0.05,
            average_volume_10d=100_000.0,
        )
        ranked = rank_candidates([thin, liquid], limit=2)
        self.assertEqual([candidate.stock.ticker for candidate in ranked], ["LIQ", "THIN"])

    def test_event_today_lowers_score_and_warns(self) -> None:
        today = date(2026, 11, 5)
        base = rank_candidates([make_stock(ticker="BASE")], today=today)[0]
        event = rank_candidates(
            [make_stock(ticker="EVENT", earnings_date=today)],
            today=today,
        )[0]
        self.assertLess(event.score, base.score)
        self.assertIn("Resultat i dag", event.warnings)

    def test_rank_respects_limit(self) -> None:
        stocks = [
            make_stock(ticker=f"S{index:02d}", week_return=0.02 + index / 1000)
            for index in range(10)
        ]
        self.assertEqual(len(rank_candidates(stocks, limit=5)), 5)


class ParsePayloadTests(unittest.TestCase):
    def test_parses_fields(self) -> None:
        stocks = parse_payload(make_payload())
        self.assertEqual(len(stocks), 1)
        stock = stocks[0]
        self.assertEqual(stock.ticker, "TEST")
        self.assertEqual(stock.name, "Test ASA")
        self.assertAlmostEqual(stock.week_return or 0, 0.03)
        self.assertAlmostEqual(stock.ath or 0, 120.0)
        self.assertEqual(stock.sector, "Industrials")
        self.assertEqual(stock.instrument_type, "stock")
        self.assertEqual(stock.earnings_date, date(2026, 11, 5))
        self.assertEqual(stock.ex_dividend_date, date(2026, 11, 13))

    def test_parses_liquidity_and_volatility(self) -> None:
        stocks = parse_payload(
            make_payload(
                average_volume_10d_calc=2_000_000.0,
                ATR=3.25,
            )
        )
        self.assertEqual(stocks[0].average_volume_10d, 2_000_000.0)
        self.assertEqual(stocks[0].atr, 3.25)

    def test_marks_growth_tickers(self) -> None:
        stocks = parse_payload(make_payload(), growth_tickers={"TEST"})
        self.assertEqual(stocks[0].market, "euronext_growth")
        self.assertTrue(stocks[0].is_growth)

    def test_main_market_is_default(self) -> None:
        stocks = parse_payload(make_payload(), growth_tickers={"OTHER"})
        self.assertEqual(stocks[0].market, "oslo")
        self.assertFalse(stocks[0].is_growth)

    def test_parses_unix_timestamps_as_oslo_dates(self) -> None:
        earnings = datetime(2026, 11, 5, 12, tzinfo=timezone.utc).timestamp()
        ex_date = datetime(2026, 11, 13, 12, tzinfo=timezone.utc).timestamp()
        stocks = parse_payload(
            make_payload(
                earnings_release_next_date=earnings,
                dividend_ex_date_upcoming=ex_date,
            )
        )
        self.assertEqual(stocks[0].earnings_date, date(2026, 11, 5))
        self.assertEqual(stocks[0].ex_dividend_date, date(2026, 11, 13))

    def test_skips_row_without_close(self) -> None:
        self.assertEqual(parse_payload(make_payload(close=None)), [])

    def test_skips_row_without_ticker(self) -> None:
        payload = make_payload()
        payload["data"][0]["s"] = ""
        payload["data"][0]["d"][COLUMNS.index("name")] = ""
        self.assertEqual(parse_payload(payload), [])

    def test_tolerates_extra_and_missing_values(self) -> None:
        payload = make_payload()
        payload["data"][0]["d"].append("uventet")
        stocks = parse_payload(payload)
        self.assertEqual(len(stocks), 1)

    def test_rejects_payload_without_data_list(self) -> None:
        with self.assertRaises(DataSourceError):
            parse_payload({"data": "nei"})


class FetchCacheTests(unittest.TestCase):
    def test_fresh_cache_is_used_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "cache.json"
            cache_path.write_text(
                json.dumps({"fetched_at": time.time(), "payload": make_payload()}),
                encoding="utf-8",
            )
            with (
                mock.patch("oslo_screener.data._post_scanner") as post,
                mock.patch(
                    "oslo_screener.data.fetch_growth_tickers",
                    return_value=make_growth_list(),
                ),
            ):
                universe = fetch_universe(cache_path=cache_path)
            post.assert_not_called()
            self.assertEqual(universe.source, "cache")
            self.assertEqual(len(universe.stocks), 1)

    def test_stale_cache_is_fallback_when_network_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "cache.json"
            cache_path.write_text(
                json.dumps({"fetched_at": time.time() - 9999, "payload": make_payload()}),
                encoding="utf-8",
            )
            with (
                mock.patch(
                    "oslo_screener.data._post_scanner",
                    side_effect=DataSourceError("nede"),
                ),
                mock.patch(
                    "oslo_screener.data.fetch_growth_tickers",
                    return_value=make_growth_list(),
                ),
            ):
                universe = fetch_universe(cache_path=cache_path, force=True, retries=1)
            self.assertEqual(universe.source, "stale-cache")
            self.assertIsNotNone(universe.warning)
            self.assertEqual(len(universe.stocks), 1)

    def test_failed_fetch_without_cache_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "cache.json"
            with (
                mock.patch(
                    "oslo_screener.data._post_scanner",
                    side_effect=DataSourceError("nede"),
                ),
                mock.patch(
                    "oslo_screener.data.fetch_growth_tickers",
                    return_value=make_growth_list(),
                ),
            ):
                with self.assertRaises(DataSourceError):
                    fetch_universe(cache_path=cache_path, force=True, retries=1)

    def test_live_fetch_writes_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "cache.json"
            with (
                mock.patch(
                    "oslo_screener.data._post_scanner",
                    return_value=make_payload(),
                ),
                mock.patch(
                    "oslo_screener.data.fetch_growth_tickers",
                    return_value=make_growth_list(),
                ),
            ):
                universe = fetch_universe(cache_path=cache_path, force=True)
            self.assertEqual(universe.source, "live")
            self.assertTrue(cache_path.exists())
            saved = json.loads(cache_path.read_text(encoding="utf-8"))
            self.assertIn("payload", saved)

    def test_fetch_universe_marks_growth_from_growth_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "cache.json"
            with (
                mock.patch(
                    "oslo_screener.data._post_scanner",
                    return_value=make_payload(),
                ),
                mock.patch(
                    "oslo_screener.data.fetch_growth_tickers",
                    return_value=make_growth_list("TEST"),
                ),
            ):
                universe = fetch_universe(cache_path=cache_path, force=True)
            self.assertTrue(universe.stocks[0].is_growth)
            self.assertEqual(universe.growth_source, "cache")


class GrowthListTests(unittest.TestCase):
    def test_parse_extracts_growth_tickers(self) -> None:
        tickers = parse_growth_payload(make_growth_payload("DVD", "AASB"))
        self.assertEqual(tickers, frozenset({"DVD", "AASB"}))

    def test_parse_skips_other_markets(self) -> None:
        payload = make_growth_payload("DVD", "MAIN")
        payload["aaData"][1][3] = "Oslo Børs"
        self.assertEqual(parse_growth_payload(payload), frozenset({"DVD"}))

    def test_parse_rejects_incomplete_payload(self) -> None:
        payload = make_growth_payload("DVD")
        payload["iTotalRecords"] = 2
        with self.assertRaises(MarketDataSourceError):
            parse_growth_payload(payload)

    def test_parse_rejects_missing_rows(self) -> None:
        with self.assertRaises(MarketDataSourceError):
            parse_growth_payload({"iTotalRecords": 1})

    def test_fresh_cache_is_used_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "growth.json"
            cache_path.write_text(
                json.dumps({"fetched_at": time.time(), "tickers": ["DVD"]}),
                encoding="utf-8",
            )
            with mock.patch(
                "oslo_screener.markets._fetch_growth_with_retry"
            ) as fetch:
                growth = fetch_growth_tickers(cache_path=cache_path)
            fetch.assert_not_called()
            self.assertEqual(growth.source, "cache")
            self.assertEqual(growth.tickers, frozenset({"DVD"}))

    def test_live_fetch_writes_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "growth.json"
            with mock.patch(
                "oslo_screener.markets._fetch_growth_with_retry",
                return_value=make_growth_payload("DVD", "AASB"),
            ):
                growth = fetch_growth_tickers(cache_path=cache_path, force=True)
            self.assertEqual(growth.source, "live")
            self.assertEqual(growth.tickers, frozenset({"DVD", "AASB"}))
            saved = json.loads(cache_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["tickers"], ["AASB", "DVD"])

    def test_stale_cache_is_used_when_fetch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "growth.json"
            cache_path.write_text(
                json.dumps(
                    {"fetched_at": time.time() - 999999, "tickers": ["DVD"]}
                ),
                encoding="utf-8",
            )
            with mock.patch(
                "oslo_screener.markets._fetch_growth_with_retry",
                side_effect=MarketDataSourceError("nede"),
            ):
                growth = fetch_growth_tickers(
                    cache_path=cache_path,
                    force=True,
                    retries=1,
                )
            self.assertEqual(growth.source, "stale-cache")
            self.assertEqual(growth.tickers, frozenset({"DVD"}))
            self.assertIn("cache", growth.warning or "")

    def test_fetch_failure_without_cache_is_graceful(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "growth.json"
            with mock.patch(
                "oslo_screener.markets._fetch_growth_with_retry",
                side_effect=MarketDataSourceError("nede"),
            ):
                growth = fetch_growth_tickers(
                    cache_path=cache_path,
                    force=True,
                    retries=1,
                )
            self.assertEqual(growth.source, "error")
            self.assertEqual(growth.tickers, frozenset())
            self.assertIn("Euronext Growth", growth.warning or "")


class NordnetTests(unittest.TestCase):
    def test_known_ticker_gets_exact_slug(self) -> None:
        self.assertEqual(
            nordnet_url(make_stock()),
            "https://www.nordnet.no/aksjer/kurser/equinor-eqnr-xosl",
        )

    def test_unknown_ticker_gets_generated_slug(self) -> None:
        url = nordnet_url(make_stock(ticker="XYZ", name="Test Selskap ASA"))
        self.assertEqual(
            url,
            "https://www.nordnet.no/aksjer/kurser/test-selskap-xyz-xosl",
        )


class NewsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.oslo = ZoneInfo("Europe/Oslo")
        self.since = datetime(2026, 10, 29, 8, 0, tzinfo=timezone.utc)
        self.fetched_at = datetime(2026, 10, 30, 7, 0, tzinfo=timezone.utc)

    def _feed(self):
        return parse_news_payload(
            make_news_payload(),
            since=self.since,
            fetched_at=self.fetched_at,
            source="live",
        )

    def _universe(self, stock: Stock):
        from oslo_screener.data import Universe

        return Universe(
            stocks=[stock],
            fetched_at=self.fetched_at,
            source="live",
        )

    def test_last_market_open_before_open(self) -> None:
        now = datetime(2026, 10, 30, 7, 59, tzinfo=self.oslo)
        self.assertEqual(
            last_market_open(now),
            datetime(2026, 10, 29, 9, 0, tzinfo=self.oslo),
        )

    def test_last_market_open_after_open(self) -> None:
        now = datetime(2026, 10, 30, 10, 0, tzinfo=self.oslo)
        self.assertEqual(
            last_market_open(now),
            datetime(2026, 10, 30, 9, 0, tzinfo=self.oslo),
        )

    def test_last_market_open_skips_weekend(self) -> None:
        saturday = datetime(2026, 10, 31, 12, 0, tzinfo=self.oslo)
        monday_before_open = datetime(2026, 11, 2, 8, 0, tzinfo=self.oslo)
        expected = datetime(2026, 10, 30, 9, 0, tzinfo=self.oslo)
        self.assertEqual(last_market_open(saturday), expected)
        self.assertEqual(last_market_open(monday_before_open), expected)

    def test_news_window_starts_at_previous_trading_day_close(self) -> None:
        cases = [
            (datetime(2026, 10, 30, 8, 0), datetime(2026, 10, 29, 16, 30)),
            (datetime(2026, 10, 30, 12, 0), datetime(2026, 10, 29, 16, 30)),
            # Etter stengetid beholdes dagens nyheter til midnatt.
            (datetime(2026, 10, 30, 17, 0), datetime(2026, 10, 29, 16, 30)),
            (datetime(2026, 10, 30, 23, 59), datetime(2026, 10, 29, 16, 30)),
            (datetime(2026, 10, 31, 0, 1), datetime(2026, 10, 30, 16, 30)),
            (datetime(2026, 10, 31, 12, 0), datetime(2026, 10, 30, 16, 30)),
            (datetime(2026, 11, 1, 12, 0), datetime(2026, 10, 30, 16, 30)),
            (datetime(2026, 11, 2, 8, 0), datetime(2026, 10, 30, 16, 30)),
            (datetime(2026, 11, 2, 17, 0), datetime(2026, 10, 30, 16, 30)),
            (datetime(2026, 11, 3, 8, 0), datetime(2026, 11, 2, 16, 30)),
            (datetime(2026, 11, 3, 12, 0), datetime(2026, 11, 2, 16, 30)),
        ]
        for now, expected in cases:
            with self.subTest(now=now):
                self.assertEqual(
                    news_window_start(now.replace(tzinfo=self.oslo)),
                    expected.replace(tzinfo=self.oslo),
                )

    def test_parse_groups_filters_and_sorts(self) -> None:
        feed = self._feed()
        self.assertEqual(feed.total_count, 5)
        self.assertEqual(feed.ticker_count, 3)
        kog = feed.for_ticker("KOG")
        self.assertEqual(len(kog), 3)
        self.assertEqual(kog[0].url, "https://newsweb.oslobors.no/message/1001")
        self.assertEqual(kog[0].category, "MELDEPLIKTIG HANDEL")
        self.assertEqual(feed.for_ticker("OLD"), ())

    def test_name_fallback_finds_company(self) -> None:
        stock = make_stock(ticker="UKJENT", name="DNB Bank ASA")
        items = self._feed().for_stock(stock)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].ticker, "DNB")

    def test_unique_news_prefers_norwegian_duplicate(self) -> None:
        latest = unique_news(self._feed().for_ticker("KOG"), limit=1)[0]
        self.assertIn("Meldepliktig handel", latest.title)

    def test_classify_sentiment(self) -> None:
        cases = {
            "God lønnsomhet og kapasitet til videre vekst": "positive",
            "Equinor: Ny kontrakt tildelt": "positive",
            "Selskapet varsler nedskrivning og tap": "negative",
            "KONGSBERG kansellerer og relanserer ansattaksjeprogrammet": "neutral",
            "Report for the third quarter 2026": "neutral",
            "Goodtech ASA Q3 2026": "neutral",
            "StrongPoint ASA: Financial calendar": "neutral",
            "Borgestad ASA: Key information relating to the cash dividend": "neutral",
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                self.assertEqual(classify_sentiment(title), expected)

    def test_aggregate_sentiment(self) -> None:
        feed = self._feed()
        self.assertEqual(aggregate_sentiment(feed.for_ticker("KOG")), "positive")
        self.assertEqual(aggregate_sentiment(feed.for_ticker("DNB")), "neutral")
        self.assertEqual(aggregate_sentiment(()), "neutral")

    def test_new_since_open_and_preserved_overnight_news(self) -> None:
        payload = make_news_payload()
        payload["data"]["messages"].append(
            {
                "messageId": 1007,
                "issuerSign": "KOG",
                "issuerName": "Kongsberg Gruppen ASA",
                "title": "KONGSBERG: Ny kontrakt tildelt",
                "publishedTime": "2026-10-30T08:15:00.000Z",
                "category": [{"category_no": "KONTRAKT"}],
            }
        )
        since = datetime(2026, 10, 29, 15, 30, tzinfo=timezone.utc)
        feed = parse_news_payload(
            payload,
            since=since,
            fetched_at=datetime(2026, 10, 30, 10, 0, tzinfo=self.oslo),
            source="live",
        )
        self.assertEqual(
            feed.session_open,
            datetime(2026, 10, 30, 9, 0, tzinfo=self.oslo),
        )
        self.assertEqual(feed.new_count(feed.for_ticker("KOG")), 1)
        new_item = next(
            item for item in feed.for_ticker("KOG") if item.message_id == 1007
        )
        old_item = next(
            item for item in feed.for_ticker("KOG") if item.message_id == 1001
        )
        self.assertTrue(feed.is_new_since_open(new_item))
        self.assertFalse(feed.is_new_since_open(old_item))

    def test_before_open_has_no_new_marker(self) -> None:
        feed = parse_news_payload(
            make_news_payload(),
            since=self.since,
            fetched_at=datetime(2026, 10, 30, 8, 0, tzinfo=self.oslo),
            source="live",
        )
        self.assertIsNone(feed.session_open)
        self.assertEqual(feed.new_count(feed.for_ticker("KOG")), 0)

    def test_parse_rejects_invalid_payload(self) -> None:
        with self.assertRaises(NewsSourceError):
            parse_news_payload({"data": {}}, self.since, self.fetched_at)

    def test_fetch_news_error_is_graceful(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "news.json"
            with mock.patch(
                "oslo_screener.news._fetch_with_retry",
                side_effect=NewsSourceError("nede"),
            ):
                feed = fetch_news(
                    now=self.fetched_at,
                    cache_path=cache,
                    retries=1,
                )
        self.assertEqual(feed.source, "error")
        self.assertIn("nede", feed.warning or "")
        self.assertEqual(feed.total_count, 0)

    def test_fetch_news_invalid_payload_is_graceful(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "news.json"
            with mock.patch(
                "oslo_screener.news._fetch_with_retry",
                return_value={"data": {}},
            ):
                feed = fetch_news(
                    now=self.fetched_at,
                    cache_path=cache,
                    retries=1,
                )
        self.assertEqual(feed.source, "error")
        self.assertIn("ugyldig", feed.warning or "")
        self.assertEqual(feed.total_count, 0)

    def test_fetch_news_falls_back_to_stale_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "news.json"
            with mock.patch(
                "oslo_screener.news._fetch_with_retry",
                return_value=make_news_payload(),
            ):
                first = fetch_news(
                    now=self.fetched_at,
                    cache_path=cache,
                    force=True,
                    retries=1,
                )
            self.assertEqual(first.source, "live")
            with mock.patch(
                "oslo_screener.news._fetch_with_retry",
                side_effect=NewsSourceError("nede"),
            ):
                second = fetch_news(
                    now=self.fetched_at,
                    cache_path=cache,
                    force=True,
                    retries=1,
                )
        self.assertEqual(second.source, "stale-cache")
        self.assertIn("cache", second.warning or "")
        # Vinduet starter ved forrige handelsdags stengetid, ikke siste åpning.
        self.assertEqual(second.total_count, 3)
        self.assertEqual(second.ticker_count, 2)

    def test_dashboard_shows_news_section_and_badge(self) -> None:
        stock = make_stock(ticker="KOG", name="Kongsberg Gruppen ASA")
        result = screen([stock], Criteria())
        page = render_dashboard(
            result,
            self._universe(stock),
            Criteria(),
            web_mode=True,
            news=self._feed(),
        )
        self.assertIn("Nyheter siden forrige handelsdag", page)
        self.assertIn("siden forrige handelsdag stengte", page)
        self.assertIn("Meldepliktig handel", page)
        self.assertIn("news-badge-positive", page)
        self.assertIn('class="sentiment sentiment-positive"', page)
        self.assertIn("3 meldinger", page)
        self.assertIn("stikkordsanalyse", page)

    def test_dashboard_escapes_news_title(self) -> None:
        payload = make_news_payload()
        payload["data"]["messages"][0]["title"] = (
            "KONGSBERG <script>alert(1)</script>"
        )
        feed = parse_news_payload(payload, since=self.since, fetched_at=self.fetched_at)
        stock = make_stock(ticker="KOG", name="Kongsberg Gruppen ASA")
        result = screen([stock], Criteria())
        page = render_dashboard(
            result,
            self._universe(stock),
            Criteria(),
            web_mode=True,
            news=feed,
        )
        self.assertNotIn("<script>alert(1)</script>", page)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", page)

    def test_dashboard_marks_news_since_open(self) -> None:
        payload = make_news_payload()
        payload["data"]["messages"].append(
            {
                "messageId": 1007,
                "issuerSign": "KOG",
                "issuerName": "Kongsberg Gruppen ASA",
                "title": "KONGSBERG: Ny kontrakt tildelt",
                "publishedTime": "2026-10-30T08:15:00.000Z",
                "category": [{"category_no": "KONTRAKT"}],
            }
        )
        feed = parse_news_payload(
            payload,
            since=datetime(2026, 10, 29, 15, 30, tzinfo=timezone.utc),
            fetched_at=datetime(2026, 10, 30, 10, 0, tzinfo=self.oslo),
            source="live",
        )
        stock = make_stock(ticker="KOG", name="Kongsberg Gruppen ASA")
        result = screen([stock], Criteria())
        page = render_dashboard(
            result,
            self._universe(stock),
            Criteria(),
            web_mode=True,
            news=feed,
        )
        self.assertIn('class="news-new">NY</span>', page)
        self.assertIn("1 ny siden siste åpning", page)
        self.assertIn("1 ny siden åpning", page)

    def test_dashboard_keeps_older_news_behind_expander(self) -> None:
        payload = make_news_payload()
        for message_id, title, published in [
            (1007, "KONGSBERG: Ny kontrakt tildelt", "2026-10-30T08:15:00.000Z"),
            (1008, "KONGSBERG: Ny avtale inngått", "2026-10-30T08:20:00.000Z"),
        ]:
            payload["data"]["messages"].append(
                {
                    "messageId": message_id,
                    "issuerSign": "KOG",
                    "issuerName": "Kongsberg Gruppen ASA",
                    "title": title,
                    "publishedTime": published,
                    "category": [{"category_no": "KONTRAKT"}],
                }
            )
        feed = parse_news_payload(
            payload,
            since=datetime(2026, 10, 29, 15, 30, tzinfo=timezone.utc),
            fetched_at=datetime(2026, 10, 30, 10, 0, tzinfo=self.oslo),
            source="live",
        )
        stock = make_stock(ticker="KOG", name="Kongsberg Gruppen ASA")
        result = screen([stock], Criteria())
        page = render_dashboard(
            result,
            self._universe(stock),
            Criteria(),
            web_mode=True,
            news=feed,
        )
        self.assertIn("Vis 1 eldre melding", page)
        self.assertIn("KONGSBERG: Ny avtale inngått", page)

    def test_terminal_shows_news(self) -> None:
        stock = make_stock(ticker="KOG", name="Kongsberg Gruppen ASA")
        result = screen([stock], Criteria())
        text = render_terminal(
            result,
            self._universe(stock),
            Criteria(),
            color=False,
            news=self._feed(),
        )
        self.assertIn("Børsmeldinger siden forrige handelsdag stengte", text)
        self.assertIn("Meldepliktig handel", text)
        self.assertIn("KOG📰▲", text)
        self.assertIn("▲ positiv", text)

    def test_result_to_dict_includes_news(self) -> None:
        stock = make_stock(ticker="KOG", name="Kongsberg Gruppen ASA")
        result = screen([stock], Criteria())
        data = result_to_dict(
            result,
            self._universe(stock),
            Criteria(),
            news=self._feed(),
        )
        self.assertEqual(data["news"]["total_count"], 5)
        self.assertEqual(data["news"]["ticker_count"], 3)
        self.assertEqual(data["news"]["window"], "previous_trading_day_close")
        candidate = data["top_candidates"][0]
        self.assertEqual(candidate["news_count"], 3)
        self.assertEqual(candidate["news_sentiment"], "positive")
        self.assertEqual(candidate["latest_news"]["sentiment"], "neutral")
        self.assertIn("Meldepliktig handel", candidate["latest_news"]["title"])
        self.assertEqual(
            candidate["latest_news"]["url"],
            "https://newsweb.oslobors.no/message/1001",
        )


class EventFormattingTests(unittest.TestCase):
    def test_days_until(self) -> None:
        self.assertEqual(days_until(date(2026, 11, 5), date(2026, 10, 29)), 7)
        self.assertIsNone(days_until(None))

    def test_format_days_until(self) -> None:
        today = date(2026, 10, 29)
        self.assertEqual(format_days_until(today, today), "i dag")
        self.assertEqual(format_days_until(today + timedelta(days=1), today), "1 dag")
        self.assertEqual(format_days_until(today + timedelta(days=14), today), "14 d")
        self.assertEqual(format_days_until(today - timedelta(days=1), today), "–")
        self.assertEqual(format_days_until(None), "–")

    def test_format_date(self) -> None:
        self.assertEqual(format_date(date(2026, 11, 5)), "05.11.2026")
        self.assertEqual(format_date(None), "–")

    def test_stock_to_dict_has_days_to_events(self) -> None:
        stock = make_stock(
            earnings_date=date.today() + timedelta(days=5),
            ex_dividend_date=date.today() + timedelta(days=12),
        )
        data = stock_to_dict(stock)
        self.assertEqual(data["days_to_earnings"], 5)
        self.assertEqual(data["days_to_ex_dividend"], 12)
        self.assertEqual(data["average_turnover"], 100_000_000.0)
        self.assertEqual(data["atr_pct"], 2.5)

    def test_stock_to_dict_has_market(self) -> None:
        data = stock_to_dict(make_stock(market="euronext_growth"))
        self.assertEqual(data["market"], "euronext_growth")
        self.assertTrue(data["is_growth"])

    def test_result_to_dict_has_top_candidates(self) -> None:
        from oslo_screener.data import Universe

        stock = make_stock(earnings_date=date.today() + timedelta(days=1))
        result = screen([stock], Criteria())
        universe = Universe(
            stocks=[stock],
            fetched_at=datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc),
            source="live",
        )
        data = result_to_dict(result, universe, Criteria())
        self.assertEqual(len(data["top_candidates"]), 1)
        candidate = data["top_candidates"][0]
        self.assertEqual(candidate["ticker"], "EQNR")
        self.assertIn("score", candidate)
        self.assertIn("Resultat i morgen", candidate["warnings"])

    def test_result_to_dict_reports_growth_filter(self) -> None:
        from oslo_screener.data import Universe

        stock = make_stock(market="euronext_growth")
        result = screen([stock], Criteria())
        universe = Universe(
            stocks=[stock],
            fetched_at=datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc),
            source="live",
            growth_tickers=frozenset({"EQNR"}),
            growth_source="live",
        )
        data = result_to_dict(result, universe, Criteria())
        self.assertEqual(data["counts"]["euronext_growth_excluded"], 1)
        self.assertEqual(data["markets"]["euronext_growth"]["tickers"], 1)
        self.assertEqual(data["markets"]["euronext_growth"]["source"], "live")


class RenderTests(unittest.TestCase):
    def _universe(self):
        from oslo_screener.data import Universe
        from datetime import datetime, timezone

        return Universe(
            stocks=[make_stock()],
            fetched_at=datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc),
            source="live",
        )

    def test_terminal_contains_ticker_and_title(self) -> None:
        result = screen([make_stock()], Criteria())
        text = render_terminal(result, self._universe(), Criteria(), color=False)
        self.assertIn("Tollbugata Profits", text)
        self.assertIn("EQNR", text)
        self.assertIn("1 treff", text)

    def test_terminal_shows_days_to_events_on_normal_width(self) -> None:
        stock = make_stock(
            earnings_date=date.today() + timedelta(days=5),
            ex_dividend_date=date.today() + timedelta(days=12),
        )
        result = screen([stock], Criteria())
        with mock.patch("oslo_screener.render._terminal_width", return_value=110):
            text = render_terminal(result, self._universe(), Criteria(), color=False)
        self.assertIn("NESTE", text)
        self.assertIn("R 5d", text)
        self.assertIn("E 12d", text)

    def test_dashboard_escapes_company_name(self) -> None:
        stock = make_stock(name="<script>alert(1)</script>")
        result = screen([stock], Criteria())
        page = render_dashboard(result, self._universe(), Criteria(), web_mode=False)
        self.assertNotIn("<script>alert(1)</script>", page)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", page)

    def test_dashboard_has_rows_and_filters(self) -> None:
        result = screen([make_stock()], Criteria())
        page = render_dashboard(result, self._universe(), Criteria(), web_mode=True)
        self.assertIn('id="stocks-table"', page)
        self.assertIn('id="min_week"', page)
        self.assertIn('id="growth"', page)
        self.assertIn("Euronext Growth skjult", page)
        self.assertIn("Hent på nytt", page)

    def test_dashboard_hides_growth_by_default(self) -> None:
        stock = make_stock(market="euronext_growth")
        result = screen([stock], Criteria())
        page = render_dashboard(result, self._universe(), Criteria(), web_mode=True)
        self.assertNotIn('data-ticker="EQNR"', page)
        self.assertIn("Euronext Growth (ikke ASK)", page)

    def test_dashboard_labels_growth_when_included(self) -> None:
        stock = make_stock(market="euronext_growth")
        criteria = Criteria(exclude_growth=False)
        result = screen([stock], criteria)
        page = render_dashboard(result, self._universe(), criteria, web_mode=True)
        self.assertIn('data-ticker="EQNR"', page)
        self.assertIn("Euronext Growth", page)
        self.assertIn('id="growth" name="growth" value="1" checked', page)

    def test_dashboard_has_top_candidates(self) -> None:
        result = screen([make_stock()], Criteria())
        page = render_dashboard(result, self._universe(), Criteria(), web_mode=True)
        self.assertIn("Kandidatene er et teknisk utgangspunkt", page)
        self.assertIn("pick-score", page)
        self.assertIn("Ikke et kjøpssignal", page)

    def test_terminal_has_top_candidates(self) -> None:
        result = screen(
            [
                make_stock(),
                make_stock(ticker="DNB", name="DNB Bank ASA"),
            ],
            Criteria(),
        )
        text = render_terminal(result, self._universe(), Criteria(), color=False)
        self.assertIn("Alternativer", text)
        self.assertIn("Netto scenarier opp", text)

    def test_dashboard_links_to_nordnet_chart(self) -> None:
        result = screen([make_stock()], Criteria())
        page = render_dashboard(result, self._universe(), Criteria(), web_mode=True)
        self.assertIn("https://www.nordnet.no/aksjer/kurser/equinor-eqnr-xosl", page)
        self.assertIn('target="_blank"', page)
        self.assertIn('rel="noopener noreferrer"', page)
        self.assertIn("Nordnet ↗", page)

    def test_dashboard_shows_earnings_and_ex_date(self) -> None:
        earnings = date.today() + timedelta(days=5)
        ex_date = date.today() + timedelta(days=12)
        stock = make_stock(earnings_date=earnings, ex_dividend_date=ex_date)
        result = screen([stock], Criteria())
        page = render_dashboard(result, self._universe(), Criteria(), web_mode=True)
        self.assertIn("Resultat", page)
        self.assertIn("Ex-dato", page)
        self.assertIn(f'data-earnings="5"', page)
        self.assertIn(f'data-exdate="12"', page)
        self.assertIn(f'title="{earnings:%d.%m.%Y}"', page)
        self.assertIn(f'title="{ex_date:%d.%m.%Y}"', page)
        self.assertIn("5 d", page)
        self.assertIn("12 d", page)

    def test_static_dashboard_has_no_refresh_link(self) -> None:
        result = screen([make_stock()], Criteria())
        page = render_dashboard(result, self._universe(), Criteria(), web_mode=False)
        self.assertNotIn("Hent på nytt", page)

    def test_dashboard_flags_at_high_clearly(self) -> None:
        result = screen([make_stock(close=110.0)], Criteria())
        page = render_dashboard(result, self._universe(), Criteria(), web_mode=True)
        self.assertIn('class="badge"', page)
        self.assertIn("is-ath", page)
        self.assertIn("Vis ATH-aksjer", page)
        self.assertIn("På/ved ATH", page)

    def test_terminal_flags_at_high(self) -> None:
        result = screen([make_stock(close=110.0)], Criteria())
        text = render_terminal(result, self._universe(), Criteria(), color=False)
        self.assertIn("FLAGG", text)
        self.assertIn("ATH", text)


if __name__ == "__main__":
    unittest.main()
