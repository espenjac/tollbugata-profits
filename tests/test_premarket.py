"""Tester for pre-market-scoring, kurtasje, rapportlagring og backtest."""

from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from oslo_screener.backtest import (
    Bar,
    _simulate_bar,
    load_bars,
    run_backtest,
    stock_as_of,
)
from oslo_screener.config import Settings, load_settings
from oslo_screener.data import Universe
from oslo_screener.logic import Criteria, screen
from oslo_screener.models import Stock
from oslo_screener.news import (
    NewsFeed,
    NewsItem,
    aggregate_news_signal,
    classify_news,
    classify_sentiment,
)
from oslo_screener.premarket import (
    build_premarket_report,
    list_saved_reports,
    load_report_history,
    save_daily_report,
    save_report,
)
from oslo_screener.render import render_dashboard
from oslo_screener.serialize import premarket_to_dict, result_to_dict
from oslo_screener.strategy import rank_candidates
from oslo_screener.trade import build_trade_plan, simulate_net


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


def make_news(
    *,
    ticker: str = "EQNR",
    title: str = "Equinor: Ny kontrakt tildelt",
    sentiment: str = "positive",
    event_type: str = "contract",
    relevance: str = "high",
    minutes_ago: int = 0,
    message_id: int = 1,
) -> NewsItem:
    now = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return NewsItem(
        ticker=ticker,
        issuer_name="Equinor ASA",
        title=title,
        published_at=now,
        category="KONTRAKT",
        message_id=message_id,
        url=f"https://example.test/message/{message_id}",
        sentiment=sentiment,
        event_type=event_type,
        relevance=relevance,
    )


def make_feed(*items: NewsItem) -> NewsFeed:
    now = datetime.now(timezone.utc)
    return NewsFeed(
        items_by_ticker={item.ticker: (item,) for item in items},
        items_by_name={},
        fetched_at=now,
        since=now - timedelta(hours=12),
        source="test",
    )


def make_universe(stocks: list[Stock]) -> Universe:
    return Universe(
        stocks=stocks,
        fetched_at=datetime.now(timezone.utc),
        source="test",
    )


def make_bars(days: int = 90, ticker: str = "TEST") -> list[Bar]:
    start = date(2025, 1, 1)
    bars: list[Bar] = []
    for index in range(days):
        # Litt takvariasjon gjør at RSI ikke blir 100, slik at aksjen faktisk
        # kan passere kandidatfiltrene i testen.
        close = 100.0 + index * 0.25 + (0.6 if index % 4 else -0.6)
        bars.append(
            Bar(
                date=start + timedelta(days=index),
                ticker=ticker,
                open=close - 0.05,
                high=close + 1.0,
                low=close - 1.0,
                close=close,
                volume=1_000_000.0,
                name="Test ASA",
                sector="Test",
                market_cap=5_000_000_000.0,
            )
        )
    return bars


class NewsClassificationTests(unittest.TestCase):
    def test_capital_raise_is_negative_even_with_growth_words(self) -> None:
        result = classify_news(
            "Rettet emisjon fullt tegnet – sterk vekst og ny kontrakt"
        )
        self.assertEqual(result.sentiment, "negative")
        self.assertEqual(result.event_type, "capital_raise")
        self.assertEqual(result.relevance, "high")
        # Den gamle stikkordsanalysen kan fortsatt si positivt; den nye
        # hendelsesklassifiseringen skal overstyre den.
        self.assertEqual(classify_sentiment("Sterk vekst og ny kontrakt"), "positive")

    def test_insider_sale_is_negative(self) -> None:
        result = classify_news("Primærinnsider selger aksjer")
        self.assertEqual(result.sentiment, "negative")
        self.assertEqual(result.event_type, "insider")

    def test_contract_is_positive_and_relevant(self) -> None:
        result = classify_news("Equinor: Ny kontrakt tildelt")
        self.assertEqual(result.sentiment, "positive")
        self.assertEqual(result.event_type, "contract")
        self.assertEqual(result.relevance, "high")

    def test_aggregate_negative_news_is_not_hidden(self) -> None:
        items = (
            make_news(
                title="Emisjon",
                sentiment="negative",
                event_type="capital_raise",
                minutes_ago=0,
                message_id=1,
            ),
            make_news(
                title="Ny kontrakt",
                sentiment="positive",
                event_type="contract",
                minutes_ago=0,
                message_id=2,
            ),
        )
        signal = aggregate_news_signal(items)
        self.assertEqual(signal.sentiment, "mixed")
        self.assertEqual(signal.event_type, "capital_raise")
        self.assertTrue(signal.is_negative)


class TradeTests(unittest.TestCase):
    def test_whole_shares_and_fees(self) -> None:
        plan = build_trade_plan(100.0, Settings().trade)
        self.assertEqual(plan.shares, 49)
        self.assertEqual(plan.invested, 4900.0)
        self.assertEqual(plan.total_cost, 4929.0)
        self.assertEqual(plan.target_net, 40.0)
        self.assertEqual(plan.stop_net, -156.0)
        self.assertAlmostEqual(plan.reward_risk or 0.0, 40.0 / 156.0)

    def test_scenarios_include_all_requested_levels(self) -> None:
        plan = build_trade_plan(100.0, Settings().trade)
        changes = [item.change_pct for item in plan.scenarios]
        self.assertEqual(changes, [-0.02, -0.01, 0.01, 0.02, 0.03, 0.04, 0.05])
        plus_two = next(item for item in plan.scenarios if item.change_pct == 0.02)
        self.assertEqual(plus_two.net_profit, 40.0)

    def test_too_little_capital_gives_zero_shares(self) -> None:
        settings = Settings()
        settings = replace(settings, trade=replace(settings.trade, capital=100.0))
        plan = build_trade_plan(100.0, settings.trade)
        self.assertEqual(plan.shares, 0)
        self.assertFalse(plan.feasible)

    def test_simulate_net_uses_fees(self) -> None:
        shares, net, pct = simulate_net(100.0, 102.0, Settings().trade)
        self.assertEqual(shares, 49)
        self.assertEqual(net, 40.0)
        self.assertAlmostEqual(pct, 40.0 / 4929.0 * 100.0)

    def test_simulate_net_applies_buy_and_sell_slippage(self) -> None:
        clean_shares, clean_net, _ = simulate_net(100.0, 102.0, Settings().trade)
        trade = replace(Settings().trade, slippage_pct=0.01)
        slipped_shares, slipped_net, _ = simulate_net(100.0, 102.0, trade)
        self.assertLessEqual(slipped_shares, clean_shares)
        self.assertLess(slipped_net, clean_net)


class PremarketReportTests(unittest.TestCase):
    def test_healthy_stock_becomes_main_candidate(self) -> None:
        stock = make_stock()
        report = build_premarket_report(
            screen([stock], Criteria()).matches,
            Criteria(),
            make_universe([stock]),
        )
        self.assertIsNotNone(report.main)
        self.assertEqual(report.main.candidate.stock.ticker, "EQNR")
        self.assertIn("momentum", report.main.candidate.categories)
        self.assertGreater(report.main.trade.shares, 0)

    def test_negative_news_blocks_main_recommendation(self) -> None:
        stock = make_stock()
        news = make_feed(
            make_news(
                title="Rettet emisjon – selskapet henter kapital",
                sentiment="negative",
                event_type="capital_raise",
            )
        )
        report = build_premarket_report(
            screen([stock], Criteria()).matches,
            Criteria(),
            make_universe([stock]),
            news=news,
        )
        self.assertIsNone(report.main)
        self.assertIn(
            "Ingen anbefalte kandidater i dag – vurder å stå over.",
            report.no_trade_reason or "",
        )
        self.assertNotIn("news", report.ranked[0].candidate.categories)
        self.assertTrue(
            any("Emisjon" in warning for warning in report.ranked[0].candidate.warnings)
        )

    def test_positive_news_adds_news_category(self) -> None:
        stock = make_stock()
        news = make_feed(make_news())
        candidates = rank_candidates([stock], news=news)
        self.assertIn("news", candidates[0].categories)
        self.assertGreater(candidates[0].news_signal.count, 0)

    def test_upcoming_earnings_are_warned_about(self) -> None:
        stock = make_stock(earnings_date=date.today() + timedelta(days=5))
        candidate = rank_candidates([stock])[0]
        self.assertIn("Resultat om 5 dager", candidate.warnings)

    def test_bad_spread_is_warned_about(self) -> None:
        stock = make_stock(spread_pct=0.01)
        candidate = rank_candidates([stock])[0]
        self.assertIn("Stor spread – bruk limit og vurder å stå over", candidate.warnings)

    def test_main_can_be_found_below_first_ranked_candidate(self) -> None:
        blocked = make_stock(
            ticker="BAD",
            week_return=0.10,
            month_return=0.20,
            quarter_return=0.30,
        )
        good = make_stock(ticker="GOOD")
        news = make_feed(
            make_news(
                ticker="BAD",
                title="Rettet emisjon",
                sentiment="negative",
                event_type="capital_raise",
            )
        )
        settings = replace(
            Settings(),
            report=replace(Settings().report, max_alternatives=0),
        )
        result = screen([blocked, good], Criteria())
        ranked = rank_candidates(result.matches, news=news)
        self.assertEqual(ranked[0].stock.ticker, "BAD")
        report = build_premarket_report(
            result.matches,
            Criteria(),
            make_universe([blocked, good]),
            news=news,
            settings=settings,
        )
        self.assertIsNotNone(report.main)
        self.assertEqual(report.main.candidate.stock.ticker, "GOOD")

    def test_target_that_does_not_cover_fees_blocks_trade(self) -> None:
        stock = make_stock(close=50.0, sma5=49.0, sma20=48.0, sma50=45.0)
        settings = replace(
            Settings(),
            trade=replace(Settings().trade, capital=100.0),
        )
        report = build_premarket_report(
            screen([stock], Criteria()).matches,
            Criteria(),
            make_universe([stock]),
            settings=settings,
        )
        self.assertIsNone(report.main)
        self.assertTrue(
            any("gevinstmålet dekker ikke kurtasjen" in reason for reason in report.ranked[0].block_reasons)
        )
        self.assertIn("Ingen anbefalte kandidater i dag", report.no_trade_reason or "")

    def test_no_candidates_gives_stand_aside_message(self) -> None:
        stock = make_stock(week_return=-0.05)
        report = build_premarket_report(
            screen([stock], Criteria()).matches,
            Criteria(),
            make_universe([stock]),
        )
        self.assertIsNone(report.main)
        self.assertIn(
            "Ingen anbefalte kandidater i dag – vurder å stå over.",
            report.no_trade_reason or "",
        )
        payload = premarket_to_dict(report)
        self.assertFalse(payload["has_recommendation"])
        page = render_dashboard(
            screen([stock], Criteria()),
            make_universe([stock]),
            Criteria(),
            web_mode=False,
            report=report,
        )
        self.assertIn("Ingen anbefalte kandidater i dag", page)

    def test_report_can_be_saved_without_overwriting(self) -> None:
        stock = make_stock()
        result = screen([stock], Criteria())
        first = build_premarket_report(
            result.matches,
            Criteria(),
            make_universe([stock]),
            now=datetime(2026, 10, 31, 7, 0, tzinfo=timezone.utc),
        )
        second = build_premarket_report(
            result.matches,
            Criteria(),
            make_universe([stock]),
            now=datetime(2026, 10, 31, 7, 0, 0, 1, tzinfo=timezone.utc),
        )
        with tempfile.TemporaryDirectory() as directory:
            path1 = save_report(first, directory)
            path2 = save_report(second, directory)
            self.assertNotEqual(path1, path2)
            self.assertEqual(len(list_saved_reports(directory)), 2)
            payload1 = json.loads(path1.read_text(encoding="utf-8"))
            payload2 = json.loads(path2.read_text(encoding="utf-8"))
            self.assertNotEqual(payload1["generated_at"], payload2["generated_at"])

    def test_saved_report_includes_news_snapshot(self) -> None:
        stock = make_stock()
        result = screen([stock], Criteria())
        news = make_feed(make_news())
        report = build_premarket_report(
            result.matches,
            Criteria(),
            make_universe([stock]),
            news=news,
        )
        with tempfile.TemporaryDirectory() as directory:
            path = save_report(report, directory, news=news)
            payload = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(payload["main"]["news_count"], 1)
        self.assertEqual(payload["main"]["latest_news"]["title"], "Equinor: Ny kontrakt tildelt")
        self.assertEqual(payload["main"]["latest_news"]["event_type"], "contract")

    def test_web_saves_only_one_report_per_day(self) -> None:
        stock = make_stock()
        result = screen([stock], Criteria())
        universe = make_universe([stock])
        first = build_premarket_report(
            result.matches,
            Criteria(),
            universe,
            now=datetime(2026, 10, 31, 7, 0, tzinfo=timezone.utc),
        )
        same_day = build_premarket_report(
            result.matches,
            Criteria(),
            universe,
            now=datetime(2026, 10, 31, 8, 0, tzinfo=timezone.utc),
        )
        next_day = build_premarket_report(
            result.matches,
            Criteria(),
            universe,
            now=datetime(2026, 11, 1, 7, 0, tzinfo=timezone.utc),
        )
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNotNone(save_daily_report(first, directory))
            self.assertIsNone(save_daily_report(same_day, directory))
            self.assertIsNotNone(save_daily_report(next_day, directory))
            history = load_report_history(directory)
            self.assertEqual(len(history), 2)
            self.assertEqual(history[0]["ticker"], "EQNR")
            self.assertTrue(history[0]["recommended"])

    def test_api_payload_contains_premarket(self) -> None:
        stock = make_stock()
        result = screen([stock], Criteria())
        universe = make_universe([stock])
        report = build_premarket_report(result.matches, Criteria(), universe)
        payload = result_to_dict(
            result,
            universe,
            Criteria(),
            premarket=premarket_to_dict(report),
        )
        self.assertIn("premarket", payload)
        self.assertEqual(payload["premarket"]["main"]["ticker"], "EQNR")


class ConfigTests(unittest.TestCase):
    def test_partial_json_overrides_weights(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "scoring": {"weights": {"momentum": 0.30}},
                        "trade": {"capital": 10_000},
                    }
                ),
                encoding="utf-8",
            )
            settings = load_settings(path)
            self.assertEqual(settings.scoring.weights.momentum, 0.30)
            self.assertEqual(settings.trade.capital, 10_000.0)
            self.assertEqual(settings.scoring.weights.trend, 0.15)

    def test_unknown_config_key_raises(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text('{"scoring": {"ukjent": 1}}', encoding="utf-8")
            with self.assertRaises(ValueError):
                load_settings(path)


class BacktestTests(unittest.TestCase):
    def test_stock_as_of_does_not_use_future_bars(self) -> None:
        bars = make_bars(20)
        first = stock_as_of(bars, 10)
        changed = list(bars)
        changed[11] = replace(changed[11], close=999.0, high=1000.0, volume=9_000_000.0)
        second = stock_as_of(changed, 10)
        self.assertEqual(first, second)
        self.assertEqual(first.close, bars[10].close)

    def test_ambiguous_day_uses_stop_conservatively(self) -> None:
        bar = Bar(
            date=date(2026, 1, 2),
            ticker="TEST",
            open=100.0,
            high=103.0,
            low=97.0,
            close=101.0,
            volume=1_000_000.0,
        )
        exit_price, reason = _simulate_bar(100.0, bar, 0.02, 0.02)
        self.assertEqual(reason, "ambiguous_stop")
        self.assertEqual(exit_price, 98.0)

    def test_target_and_stop_gap_are_respected(self) -> None:
        base = Bar(
            date=date(2026, 1, 2),
            ticker="TEST",
            open=100.0,
            high=101.0,
            low=99.0,
            close=100.0,
            volume=1_000_000.0,
        )
        target = replace(base, high=103.0, low=99.0)
        self.assertEqual(_simulate_bar(100.0, target, 0.02, 0.02), (102.0, "target"))
        gap = replace(base, open=103.0, high=104.0)
        self.assertEqual(_simulate_bar(100.0, gap, 0.02, 0.02), (103.0, "target_gap"))

    def test_run_backtest_produces_top1_and_top5_metrics(self) -> None:
        bars = make_bars(90)
        settings = Settings()
        result = run_backtest(
            bars,
            settings=settings,
            start=bars[70].date,
            end=bars[-2].date,
            targets=(0.01, 0.03, 0.05),
        )
        self.assertGreater(len(result.trades), 0)
        self.assertGreater(result.top1["trades"], 0)
        self.assertGreater(result.top5["trades"], 0)
        self.assertIn("1%", result.target_summaries)
        self.assertIn("2%", result.target_summaries)
        self.assertIn("3%", result.target_summaries)
        self.assertIn("5%", result.target_summaries)
        self.assertIn("momentum", result.by_category)
        self.assertIn("breakout", result.by_category)
        self.assertIn("news", result.by_category)

    def test_load_bars_rejects_duplicate_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bars.csv"
            header = "date,ticker,open,high,low,close,volume\n"
            row = "2026-01-02,TEST,100,101,99,100,1000000\n"
            path.write_text(header + row + row, encoding="utf-8")
            with self.assertRaises(ValueError):
                load_bars(path)

    def test_web_backtest_shows_target_summaries_and_stop(self) -> None:
        stock = make_stock()
        result = screen([stock], Criteria())
        backtest = {
            "from_date": "2026-01-01",
            "to_date": "2026-02-01",
            "top1": {},
            "top5": {},
            "by_category": {},
            "target_summaries": {"1%": {}, "2%": {}, "3%": {}, "5%": {}},
            "warnings": [],
            "settings": {"trade": {"stop_loss_pct": 0.02}},
        }
        page = render_dashboard(
            result,
            make_universe([stock]),
            Criteria(),
            backtest=backtest,
        )
        self.assertIn("Treff per gevinstmål", page)
        self.assertIn("Mål 1%", page)
        self.assertIn("Mål 2%", page)
        self.assertIn("Mål 3%", page)
        self.assertIn("Mål 5%", page)
        self.assertIn("tapsgrense −2,0 %", page)


if __name__ == "__main__":
    unittest.main()
