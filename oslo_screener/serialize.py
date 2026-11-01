"""JSON-serialisering for API og --json-utdata."""

from __future__ import annotations

from dataclasses import asdict
from datetime import date
from typing import Any, Iterable, Optional

from .config import Settings
from .data import Universe
from .formatting import days_until
from .logic import Criteria, ScreenResult, is_at_high, sort_stocks
from .models import Stock
from .news import NewsFeed, NewsItem, aggregate_sentiment, unique_news
from .nordnet import nordnet_url
from .signals import EVENT_LABELS
from .strategy import Candidate, rank_candidates
from .trade import TradePlan


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _days(value: date | None) -> int | None:
    days = days_until(value)
    return days if days is not None and days >= 0 else None


def _news_fields(
    items: Iterable[NewsItem],
    feed: Optional[NewsFeed] = None,
) -> dict[str, Any]:
    items = tuple(items)
    if not items:
        return {
            "news_count": 0,
            "news_new_count": 0,
            "news_sentiment": "neutral",
            "news_event_type": "other",
            "news_relevance": "low",
            "latest_news": None,
        }
    latest = unique_news(items, limit=1)[0]
    return {
        "news_count": len(items),
        "news_new_count": feed.new_count(items) if feed is not None else 0,
        "news_sentiment": aggregate_sentiment(items),
        "news_event_type": latest.event_type,
        "news_relevance": latest.relevance,
        "latest_news": {
            "title": latest.title,
            "published_at": latest.published_at.isoformat(),
            "url": latest.url,
            "category": latest.category,
            "sentiment": latest.sentiment,
            "event_type": latest.event_type,
            "relevance": latest.relevance,
        },
    }


def stock_to_dict(
    stock: Stock,
    at_high: bool = False,
    news_items: Iterable[NewsItem] = (),
    news_feed: Optional[NewsFeed] = None,
) -> dict[str, Any]:
    data = {
        "ticker": stock.ticker,
        "name": stock.name,
        "price": stock.close,
        "currency": stock.currency,
        "market": stock.market,
        "is_growth": stock.is_growth,
        "at_high": at_high,
        "nordnet_url": nordnet_url(stock),
        "day_return_pct": _round(
            stock.day_return * 100 if stock.day_return is not None else None
        ),
        "week_return_pct": _round(stock.week_return * 100 if stock.week_return is not None else None),
        "month_return_pct": _round(stock.month_return * 100 if stock.month_return is not None else None),
        "quarter_return_pct": _round(
            stock.quarter_return * 100 if stock.quarter_return is not None else None
        ),
        "distance_to_ath_pct": _round(
            stock.distance_to_ath * 100 if stock.distance_to_ath is not None else None
        ),
        "ath": stock.ath,
        "ath_reliable": stock.ath_is_reliable,
        "high_52w": stock.high_52w,
        "sma5": stock.sma5,
        "sma20": stock.sma20,
        "rsi": _round(stock.rsi, 1),
        "market_cap": stock.market_cap,
        "sector": stock.sector,
        "volume": stock.volume,
        "average_volume_10d": stock.average_volume_10d,
        "average_turnover": stock.average_turnover,
        "atr": stock.atr,
        "atr_pct": _round(
            stock.atr_pct * 100 if stock.atr_pct is not None else None
        ),
        "earnings_date": stock.earnings_date.isoformat() if stock.earnings_date else None,
        "days_to_earnings": _days(stock.earnings_date),
        "ex_dividend_date": (
            stock.ex_dividend_date.isoformat() if stock.ex_dividend_date else None
        ),
        "days_to_ex_dividend": _days(stock.ex_dividend_date),
    }
    data.update(_news_fields(news_items, feed=news_feed))
    return data


def result_to_dict(
    result: ScreenResult,
    universe: Universe,
    criteria: Criteria,
    sort_by: str = "week",
    news: Optional[NewsFeed] = None,
    premarket: Optional[dict[str, Any]] = None,
    settings: Optional[Settings] = None,
) -> dict[str, Any]:
    stocks = sort_stocks(result.matches, sort_by)

    def _news_for(stock: Stock) -> tuple[NewsItem, ...]:
        return news.for_stock(stock) if news is not None else ()

    payload: dict[str, Any] = {
        "fetched_at": universe.fetched_at.isoformat(),
        "source": universe.source,
        "warning": universe.warning,
        "criteria": asdict(criteria),
        "counts": {
            "universe": result.universe_size,
            "matches": result.match_count,
            "at_high": result.at_high_count,
            "euronext_growth_excluded": result.excluded.get("euronext growth", 0),
            "excluded": dict(result.excluded),
        },
        "top_candidates": [
            candidate_to_dict(
                candidate,
                at_high=is_at_high(candidate.stock, criteria),
                news_items=_news_for(candidate.stock),
                news_feed=news,
            )
            for candidate in rank_candidates(
                stocks,
                limit=5,
                news=news,
                config=settings.scoring if settings is not None else None,
            )
        ],
        "stocks": [
            stock_to_dict(
                stock,
                at_high=is_at_high(stock, criteria),
                news_items=_news_for(stock),
                news_feed=news,
            )
            for stock in stocks
        ],
    }
    payload["markets"] = {
        "euronext_growth": {
            "source": universe.growth_source,
            "tickers": len(universe.growth_tickers),
            "warning": universe.growth_warning,
        }
    }
    if news is not None:
        payload["news"] = {
            "since": news.since.isoformat(),
            "window": "previous_trading_day_close",
            "session_open": (
                news.session_open.isoformat() if news.session_open else None
            ),
            "fetched_at": news.fetched_at.isoformat(),
            "source": news.source,
            "warning": news.warning,
            "total_count": news.total_count,
            "ticker_count": news.ticker_count,
        }
    if premarket is not None:
        payload["premarket"] = premarket
    return payload


def candidate_to_dict(
    candidate: Candidate,
    at_high: bool = False,
    news_items: Iterable[NewsItem] = (),
    news_feed: Optional[NewsFeed] = None,
) -> dict[str, Any]:
    """Kandidatens aksjedata pluss score, begrunnelse og risikomerknader."""
    data = stock_to_dict(
        candidate.stock,
        at_high=at_high,
        news_items=news_items,
        news_feed=news_feed,
    )
    data["score"] = _round(candidate.score, 1)
    data["opportunity_score"] = _round(candidate.opportunity_score, 1)
    data["risk_score"] = _round(candidate.risk_score, 1)
    data["risk_level"] = candidate.risk_level
    data["categories"] = list(candidate.categories)
    data["breakout_status"] = candidate.breakout_status
    data["technical_upside_pct"] = _round(
        candidate.technical_upside * 100
        if candidate.technical_upside is not None
        else None
    )
    data["resistance"] = candidate.resistance
    data["support"] = candidate.support
    data["volume_ratio"] = _round(candidate.volume_ratio)
    data["news_signal"] = candidate.news_signal.to_dict()
    data["news_signal"]["event_label"] = EVENT_LABELS.get(
        candidate.news_signal.event_type,
        candidate.news_signal.event_type,
    )
    data["reasons"] = list(candidate.reasons)
    data["warnings"] = list(candidate.warnings)
    return data


def trade_to_dict(trade: TradePlan) -> dict[str, Any]:
    return {
        "capital": trade.capital,
        "entry_price": _round(trade.entry_price),
        "shares": trade.shares,
        "invested": _round(trade.invested),
        "cash_left": _round(trade.cash_left),
        "total_cost": _round(trade.total_cost),
        "buy_fee": trade.buy_fee,
        "sell_fee": trade.sell_fee,
        "target_price": _round(trade.target_price),
        "target_net": _round(trade.target_net),
        "target_return_pct": _round(trade.target_return_pct),
        "stop_price": _round(trade.stop_price),
        "stop_net": _round(trade.stop_net),
        "stop_return_pct": _round(trade.stop_return_pct),
        "reward_risk": _round(trade.reward_risk),
        "feasible": trade.feasible,
        "scenarios": [
            {
                "change_pct": _round(item.change_pct * 100),
                "exit_price": _round(item.exit_price),
                "gross_profit": _round(item.gross_profit),
                "net_profit": _round(item.net_profit),
                "net_return_pct": _round(item.net_return_pct),
            }
            for item in trade.scenarios
        ],
    }


def planned_candidate_to_dict(
    planned: Any,
    news: Optional[NewsFeed] = None,
) -> dict[str, Any]:
    candidate: Candidate = planned.candidate
    items = news.for_stock(candidate.stock) if news is not None else ()
    data = candidate_to_dict(candidate, news_items=items, news_feed=news)
    data["trade"] = trade_to_dict(planned.trade)
    data["recommendable"] = planned.recommendable
    data["block_reasons"] = list(planned.block_reasons)
    data["category_labels"] = list(planned.category_labels)
    data["news_reason"] = planned.news_reason
    return data


def premarket_to_dict(
    report: Any,
    news: Optional[NewsFeed] = None,
) -> dict[str, Any]:
    """Serialiser en PremarketReport uten å importere premarket-modulen."""
    categories: dict[str, int] = {"momentum": 0, "breakout": 0, "news": 0}
    for planned in report.ranked:
        for category in planned.candidate.categories:
            categories[category] = categories.get(category, 0) + 1
    return {
        "generated_at": report.generated_at.isoformat(),
        "universe_fetched_at": report.universe_fetched_at.isoformat(),
        "source": report.universe_source,
        "data_basis": report.data_basis,
        "is_premarket": report.is_premarket,
        "warnings": list(report.warnings),
        "criteria": asdict(report.criteria),
        "settings": report.settings.to_dict(),
        "has_recommendation": report.has_recommendation,
        "no_trade_reason": report.no_trade_reason,
        "news_since": report.news_since.isoformat() if report.news_since else None,
        "news_source": report.news_source,
        "categories": categories,
        "main": (
            planned_candidate_to_dict(report.main, news=news)
            if report.main is not None
            else None
        ),
        "alternatives": [
            planned_candidate_to_dict(item, news=news)
            for item in report.alternatives
        ],
        "blocked": [
            planned_candidate_to_dict(item, news=news)
            for item in report.blocked
        ],
        "top_candidates": [
            candidate_to_dict(
                item.candidate,
                news_items=(
                    news.for_stock(item.candidate.stock) if news is not None else ()
                ),
                news_feed=news,
            )
            for item in report.ranked
        ],
    }
