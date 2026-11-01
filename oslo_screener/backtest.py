"""Enkel, konservativ historisk test av pre-market-rangeringen.

Modulen krever en CSV med daglige OHLCV-data. Den beregner tekniske indikatorer
på nytt for hver handelsdag, men bruker bare data fram til og med forrige
avsluttede handelsdag når den lager kandidatene. Handelen simuleres deretter på
neste handelsdag.

Datagrunnlaget har ikke intradagdata. Når både gevinstmål og tapsgrense blir
truffet samme dag, antar testen derfor at tapsgrensen ble truffet først. Det er
konservativt, men kan undervurdere resultatet. Testen kan heller ikke gjenskape
nyhetsbildet historisk uten en egen arkivfil med datidens meldinger.
"""

from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional

from .config import Settings
from .formatting import format_money
from .models import Stock
from .signals import NewsSignal
from .strategy import Candidate, rank_candidates
from .trade import simulate_net

PRIMARY_TARGET = 0.02
DEFAULT_TARGETS = (0.01, 0.02, 0.03, 0.05)


@dataclass(frozen=True)
class Bar:
    date: date
    ticker: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    name: str = ""
    sector: str = "Ukjent"
    market_cap: Optional[float] = None
    market: str = "oslo"
    news_sentiment: str = "neutral"
    news_relevance: str = "low"
    news_event: str = "other"


@dataclass(frozen=True)
class TradeRecord:
    as_of: date
    trade_date: date
    ticker: str
    rank: int
    target_pct: float
    entry: float
    exit_price: float
    exit_reason: str
    shares: int
    net_profit: float
    net_return_pct: float
    categories: tuple[str, ...]
    score: float
    opportunity_score: float
    risk_score: float


@dataclass(frozen=True)
class BacktestResult:
    from_date: Optional[date]
    to_date: Optional[date]
    settings: Settings
    trades: tuple[TradeRecord, ...]
    target_summaries: dict[str, dict[str, Any]]
    top1: dict[str, Any]
    top5: dict[str, Any]
    by_category: dict[str, dict[str, Any]]
    warnings: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "from_date": self.from_date.isoformat() if self.from_date else None,
            "to_date": self.to_date.isoformat() if self.to_date else None,
            "settings": self.settings.to_dict(),
            "trades": [
                {
                    "as_of": item.as_of.isoformat(),
                    "trade_date": item.trade_date.isoformat(),
                    "ticker": item.ticker,
                    "rank": item.rank,
                    "target_pct": item.target_pct * 100.0,
                    "entry": round(item.entry, 4),
                    "exit_price": round(item.exit_price, 4),
                    "exit_reason": item.exit_reason,
                    "shares": item.shares,
                    "net_profit": round(item.net_profit, 2),
                    "net_return_pct": round(item.net_return_pct, 3),
                    "categories": list(item.categories),
                    "score": round(item.score, 1),
                    "opportunity_score": round(item.opportunity_score, 1),
                    "risk_score": round(item.risk_score, 1),
                }
                for item in self.trades
            ],
            "target_summaries": self.target_summaries,
            "top1": self.top1,
            "top5": self.top5,
            "by_category": self.by_category,
            "warnings": list(self.warnings),
        }

    def write(self, path: str | Path) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return target


class _SignalMap:
    def __init__(self, signals: dict[str, NewsSignal]) -> None:
        self._signals = signals

    def signal_for(self, stock: Stock) -> NewsSignal:
        return self._signals.get(stock.ticker, NewsSignal())


def load_bars(path: str | Path) -> list[Bar]:
    """Les daglige OHLCV-data fra CSV.

    Påkrevde kolonner: date, ticker, open, high, low, close, volume.
    Valgfrie: name, sector, market_cap, market, news_sentiment,
    news_relevance, news_event.
    """
    bars: list[Bar] = []
    seen: set[tuple[str, date]] = set()
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError("CSV-filen mangler overskrift.")
        required = {"date", "ticker", "open", "high", "low", "close", "volume"}
        missing = required - set(reader.fieldnames)
        if missing:
            raise ValueError(f"CSV-filen mangler kolonner: {', '.join(sorted(missing))}")
        for line_number, row in enumerate(reader, 2):
            try:
                day = date.fromisoformat(str(row["date"])[:10])
                ticker = str(row["ticker"]).strip().upper()
                values = {
                    name: float(str(row[name]).replace(",", "."))
                    for name in ("open", "high", "low", "close", "volume")
                }
            except (TypeError, ValueError, KeyError) as exc:
                raise ValueError(f"Ugyldig rad {line_number} i {path}: {exc}") from exc
            if not ticker or values["close"] <= 0 or values["volume"] < 0:
                raise ValueError(f"Ugyldig rad {line_number} i {path}.")
            key = (ticker, day)
            if key in seen:
                raise ValueError(f"Duplikat for {ticker} {day} i {path}.")
            seen.add(key)
            bars.append(
                Bar(
                    date=day,
                    ticker=ticker,
                    open=values["open"],
                    high=values["high"],
                    low=values["low"],
                    close=values["close"],
                    volume=values["volume"],
                    name=str(row.get("name") or ticker).strip(),
                    sector=str(row.get("sector") or "Ukjent").strip(),
                    market_cap=_float_or_none(row.get("market_cap")),
                    market=str(row.get("market") or "oslo").strip(),
                    news_sentiment=str(row.get("news_sentiment") or "neutral").strip(),
                    news_relevance=str(row.get("news_relevance") or "low").strip(),
                    news_event=str(row.get("news_event") or "other").strip(),
                )
            )
    bars.sort(key=lambda item: (item.ticker, item.date))
    return bars


def _float_or_none(value: Any) -> Optional[float]:
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return None


def _sma(values: list[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _rsi(closes: list[float], period: int = 14) -> Optional[float]:
    if len(closes) <= period:
        return None
    gains = 0.0
    losses = 0.0
    for previous, current in zip(closes[-period - 1 : -1], closes[-period:]):
        change = current - previous
        if change >= 0:
            gains += change
        else:
            losses -= change
    if gains == 0 and losses == 0:
        return 50.0
    if losses == 0:
        return 100.0
    relative = (gains / period) / (losses / period)
    return 100.0 - 100.0 / (1.0 + relative)


def _atr(bars: list[Bar], period: int = 14) -> Optional[float]:
    if len(bars) <= period:
        return None
    ranges: list[float] = []
    for previous, current in zip(bars[-period - 1 : -1], bars[-period:]):
        ranges.append(
            max(
                current.high - current.low,
                abs(current.high - previous.close),
                abs(current.low - previous.close),
            )
        )
    return sum(ranges) / period if ranges else None


def _return(closes: list[float], days: int) -> Optional[float]:
    if len(closes) <= days or closes[-days - 1] <= 0:
        return None
    return closes[-1] / closes[-days - 1] - 1.0


def stock_as_of(bars: list[Bar], index: int) -> Stock:
    """Bygg en Stock med bare data til og med ``bars[index]``.

    Funksjonen er eksponert for tester som kontrollerer at morgendagens kurs
    ikke lekker inn i dagens kandidatvurdering.
    """
    history = bars[: index + 1]
    previous = history[-1]
    closes = [item.close for item in history]
    volumes = [item.volume for item in history]
    high_52w = max((item.high for item in history[-252:]), default=None)
    ath = max((item.high for item in history), default=None)
    average_volume = sum(volumes[-10:]) / min(10, len(volumes))
    return Stock(
        ticker=previous.ticker,
        name=previous.name or previous.ticker,
        close=previous.close,
        currency="NOK",
        day_return=_return(closes, 1),
        week_return=_return(closes, 5),
        month_return=_return(closes, 21),
        quarter_return=_return(closes, 63),
        sma5=_sma(closes, 5),
        sma20=_sma(closes, 20),
        sma50=_sma(closes, 50),
        rsi=_rsi(closes),
        ath=ath,
        high_52w=high_52w,
        market_cap=previous.market_cap,
        volume=previous.volume,
        sector=previous.sector,
        market=previous.market,
        average_volume_10d=average_volume,
        atr=_atr(history),
    )


def _signal(bar: Bar) -> NewsSignal:
    if bar.news_sentiment == "neutral" and bar.news_relevance == "low":
        return NewsSignal()
    return NewsSignal(
        sentiment=bar.news_sentiment,
        relevance=bar.news_relevance,
        event_type=bar.news_event,
        count=1,
        latest_title="Historisk nyhet fra CSV",
    )


def _simulate_bar(
    entry: float,
    bar: Bar,
    target_pct: float,
    stop_pct: float,
) -> tuple[float, str]:
    """Returner (salgspris, årsak) med konservativ håndtering av begge treff."""
    target = entry * (1.0 + target_pct)
    stop = entry * (1.0 - stop_pct)
    if bar.open <= stop:
        return bar.open, "stop_gap"
    if bar.open >= target:
        return bar.open, "target_gap"
    target_hit = bar.high >= target
    stop_hit = bar.low <= stop
    if target_hit and stop_hit:
        return stop, "ambiguous_stop"
    if target_hit:
        return target, "target"
    if stop_hit:
        return stop, "stop"
    return bar.close, "close"


def _metrics(trades: Iterable[TradeRecord]) -> dict[str, Any]:
    items = list(trades)
    if not items:
        return {
            "trades": 0,
            "target_hits": 0,
            "stop_hits": 0,
            "ambiguous": 0,
            "end_of_day": 0,
            "wins": 0,
            "losses": 0,
            "hit_rate_pct": 0.0,
            "stop_rate_pct": 0.0,
            "win_rate_pct": 0.0,
            "avg_net_profit": 0.0,
            "avg_net_return_pct": 0.0,
            "total_net_profit": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
        }
    target_hits = sum(1 for item in items if item.exit_reason.startswith("target"))
    stop_hits = sum(1 for item in items if "stop" in item.exit_reason)
    ambiguous = sum(1 for item in items if item.exit_reason == "ambiguous_stop")
    end_of_day = sum(1 for item in items if item.exit_reason == "close")
    wins = [item for item in items if item.net_profit > 0]
    losses = [item for item in items if item.net_profit <= 0]
    return {
        "trades": len(items),
        "target_hits": target_hits,
        "stop_hits": stop_hits,
        "ambiguous": ambiguous,
        "end_of_day": end_of_day,
        "wins": len(wins),
        "losses": len(losses),
        "hit_rate_pct": round(target_hits / len(items) * 100.0, 2),
        "stop_rate_pct": round(stop_hits / len(items) * 100.0, 2),
        "win_rate_pct": round(len(wins) / len(items) * 100.0, 2),
        "avg_net_profit": round(sum(item.net_profit for item in items) / len(items), 2),
        "avg_net_return_pct": round(
            sum(item.net_return_pct for item in items) / len(items), 3
        ),
        "total_net_profit": round(sum(item.net_profit for item in items), 2),
        "avg_win": round(
            sum(item.net_profit for item in wins) / len(wins), 2
        ) if wins else 0.0,
        "avg_loss": round(
            sum(item.net_profit for item in losses) / len(losses), 2
        ) if losses else 0.0,
    }


def run_backtest(
    bars: list[Bar],
    settings: Optional[Settings] = None,
    start: Optional[date] = None,
    end: Optional[date] = None,
    targets: Iterable[float] = DEFAULT_TARGETS,
) -> BacktestResult:
    """Kjør en konservativ test på daglige data."""
    cfg = settings or Settings()
    by_ticker: dict[str, list[Bar]] = defaultdict(list)
    for bar in bars:
        by_ticker[bar.ticker].append(bar)
    for items in by_ticker.values():
        items.sort(key=lambda item: item.date)

    target_values = tuple(sorted(set(targets) | {PRIMARY_TARGET}))
    if not target_values:
        raise ValueError("Minst ett gevinstmål må oppgis.")
    if any(target <= 0 for target in target_values):
        raise ValueError("Alle gevinstmål må være større enn 0.")
    index_by_key = {
        (ticker, item.date): index
        for ticker, items in by_ticker.items()
        for index, item in enumerate(items)
    }
    dates = sorted(
        {
            item.date
            for items in by_ticker.values()
            for item in items
            if (start is None or item.date >= start)
            and (end is None or item.date <= end)
        }
    )

    records: list[TradeRecord] = []
    for day in dates:
        stocks: list[Stock] = []
        signals: dict[str, NewsSignal] = {}
        next_bars: dict[str, Bar] = {}
        for ticker, items in by_ticker.items():
            index = index_by_key.get((ticker, day))
            if index is None or index < 1 or index + 1 >= len(items):
                continue
            previous = items[index]
            following = items[index + 1]
            if following.date <= previous.date or (following.date - previous.date) > timedelta(days=5):
                continue
            stocks.append(stock_as_of(items, index))
            signals[ticker] = _signal(previous)
            next_bars[ticker] = following
        if not stocks:
            continue
        ranked = rank_candidates(
            stocks,
            limit=5,
            today=day,
            news=_SignalMap(signals),
            config=cfg.scoring,
        )
        for rank, candidate in enumerate(ranked, 1):
            following = next_bars.get(candidate.stock.ticker)
            if following is None:
                continue
            entry = following.open * (1.0 + max(0.0, cfg.trade.slippage_pct))
            for target in target_values:
                exit_price, reason = _simulate_bar(
                    entry,
                    following,
                    target,
                    cfg.trade.stop_loss_pct,
                )
                shares, net, net_pct = simulate_net(following.open, exit_price, cfg.trade)
                if shares <= 0:
                    continue
                records.append(
                    TradeRecord(
                        as_of=day,
                        trade_date=following.date,
                        ticker=candidate.stock.ticker,
                        rank=rank,
                        target_pct=target,
                        entry=entry,
                        exit_price=exit_price,
                        exit_reason=reason,
                        shares=shares,
                        net_profit=net,
                        net_return_pct=net_pct,
                        categories=candidate.categories,
                        score=candidate.score,
                        opportunity_score=candidate.opportunity_score,
                        risk_score=candidate.risk_score,
                    )
                )

    target_summaries = {
        f"{target * 100:g}%": _metrics(
            item for item in records if math.isclose(item.target_pct, target)
        )
        for target in target_values
    }
    top1 = _metrics(
        item for item in records if item.rank == 1
        and math.isclose(item.target_pct, PRIMARY_TARGET)
    )
    top5 = _metrics(
        item for item in records if item.rank <= 5
        and math.isclose(item.target_pct, PRIMARY_TARGET)
    )
    by_category: dict[str, dict[str, Any]] = {}
    for category in ("momentum", "breakout", "news"):
        by_category[category] = _metrics(
            item for item in records
            if item.rank <= 5
            and math.isclose(item.target_pct, PRIMARY_TARGET)
            and category in item.categories
        )
    warnings = [
        "Daglige OHLC-data kan ikke avgjøre om gevinstmål eller tapsgrense ble "
        "truffet først. Ved begge treff antas tapsgrensen først (konservativt).",
        "Nyhetskategorien kan bare testes hvis CSV-filen inneholder historiske "
        "nyhetssignaler. Den kan ikke rekonstrueres fra NewsWeb i ettertid.",
        "Hvis CSV-filen bare inneholder aksjer som fortsatt er notert, er testen "
        "utsatt for survivorship bias.",
        "Testen bruker én tenkt handel om gangen med "
        f"{format_money(cfg.trade.capital)} kapital. Topp 5 er fem separate "
        "enkelthandler, ikke én portefølje med fem samtidige posisjoner.",
    ]
    return BacktestResult(
        from_date=dates[0] if dates else None,
        to_date=dates[-1] if dates else None,
        settings=cfg,
        trades=tuple(records),
        target_summaries=target_summaries,
        top1=top1,
        top5=top5,
        by_category=by_category,
        warnings=tuple(warnings),
    )
