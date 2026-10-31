"""Pre-market-rangering av kortsiktige kandidater.

Modellen er en relativ poengsum, ikke en sannsynlighet og ikke et kjøpssignal.
Den skiller mellom:

* **Mulighetsscore** – hvor godt teknisk og nyhetsmessig utgangspunkt aksjen har.
* **Risikoscore** – hvor utsatt en dagshandel er for kraftige negative bevegelser.
* **Samlet score** – mulighetsscoren dempet av risikoscoren.

Alle vekter og terskler ligger i :mod:`oslo_screener.config`. Standardverdiene er
startpunkter for videre testing, ikke optimaliserte parametere.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

from .config import ScoringConfig
from .formatting import days_until, format_market_cap, format_pct
from .models import Stock
from .news import NewsFeed
from .signals import NewsSignal

# Beholdt for bakoverkompatibilitet. Verdiene brukes som standard i ScoringConfig.
MIN_PRICE = 5.0
MIN_MARKET_CAP = 300_000_000.0
MIN_AVERAGE_TURNOVER = 5_000_000.0
MAX_WEEK_RETURN = 0.25
TARGET_ATR_PCT = 0.025


@dataclass(frozen=True)
class Candidate:
    """En rangert kandidat med begrunnelse, risiko og kategorier."""

    stock: Stock
    score: float
    reasons: tuple[str, ...]
    warnings: tuple[str, ...]
    opportunity_score: float = 0.0
    risk_score: float = 0.0
    categories: tuple[str, ...] = ()
    news_signal: NewsSignal = NewsSignal()
    breakout_status: str = "ikke nær"
    technical_upside: Optional[float] = None
    resistance: Optional[float] = None
    support: Optional[float] = None
    volume_ratio: Optional[float] = None

    @property
    def risk_level(self) -> str:
        if self.risk_score < 35:
            return "Lav"
        if self.risk_score < 60:
            return "Middels"
        return "Høy"


@dataclass(frozen=True)
class ScoringContext:
    """Markedsbredde brukt til relativ styrke."""

    median_week_return: Optional[float] = None
    median_quarter_return: Optional[float] = None


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _weighted(components: dict[str, float], weights: object) -> float:
    total = float(getattr(weights, "total", 0.0))
    if total <= 0:
        return 0.0
    return sum(
        float(getattr(weights, name)) * value for name, value in components.items()
    ) / total


def is_candidate(stock: Stock, config: Optional[ScoringConfig] = None) -> bool:
    """Grovsiler bort aksjer som er dårlig egnet for en kontrollert daytrade."""
    cfg = config or ScoringConfig()
    if stock.instrument_type not in ("stock", "dr"):
        return False
    if stock.week_return is None or stock.week_return <= 0:
        return False
    if stock.week_return > cfg.max_week_return:
        return False
    if stock.close < cfg.min_price:
        return False
    if stock.sma5 is None or stock.close <= stock.sma5:
        return False
    if stock.sma20 is None or stock.close <= stock.sma20:
        return False
    if stock.month_return is not None and stock.month_return <= 0:
        return False
    if stock.rsi is not None and stock.rsi > cfg.max_rsi:
        return False
    if stock.market_cap is not None and stock.market_cap < cfg.min_market_cap:
        return False
    turnover = stock.average_turnover
    if turnover is not None and turnover < cfg.min_average_turnover:
        return False
    return True


def _context(stocks: Iterable[Stock]) -> ScoringContext:
    items = list(stocks)
    weeks = [stock.week_return for stock in items if stock.week_return is not None]
    quarters = [stock.quarter_return for stock in items if stock.quarter_return is not None]
    return ScoringContext(
        median_week_return=statistics.median(weeks) if weeks else None,
        median_quarter_return=statistics.median(quarters) if quarters else None,
    )


def _resistance(stock: Stock) -> Optional[float]:
    candidates = [
        value
        for value in (stock.high_52w, stock.ath)
        if value is not None and value > stock.close
    ]
    return min(candidates) if candidates else None


def _support(stock: Stock) -> Optional[float]:
    candidates = [
        value
        for value in (stock.sma20, stock.sma5)
        if value is not None and value < stock.close
    ]
    return max(candidates) if candidates else None


def _volume_ratio(stock: Stock) -> Optional[float]:
    if not stock.volume or not stock.average_volume_10d or stock.average_volume_10d <= 0:
        return None
    return stock.volume / stock.average_volume_10d


def _news_opportunity(signal: NewsSignal) -> float:
    if signal.count == 0:
        return 0.45
    if signal.event_type == "capital_raise":
        return 0.0
    if signal.sentiment == "negative":
        return 0.0
    if signal.sentiment == "mixed":
        return 0.25
    if signal.sentiment == "positive":
        return {"high": 0.95, "medium": 0.8, "low": 0.6}.get(signal.relevance, 0.5)
    # Nøytrale, men relevante hendelser kan fortsatt være nyttige.
    return {"high": 0.55, "medium": 0.48, "low": 0.4}.get(signal.relevance, 0.4)


def _news_risk(signal: NewsSignal) -> float:
    if signal.event_type == "capital_raise":
        return 1.0
    if signal.sentiment == "negative":
        return {"high": 1.0, "medium": 0.75, "low": 0.4}.get(signal.relevance, 0.5)
    if signal.sentiment == "mixed":
        return {"high": 0.55, "medium": 0.4, "low": 0.25}.get(signal.relevance, 0.3)
    return 0.0


def _breakout_status(stock: Stock, config: ScoringConfig, signal: NewsSignal) -> str:
    resistance = _resistance(stock)
    week = stock.week_return or 0.0
    rsi = stock.rsi
    overextended = week > config.overextended_week or (
        rsi is not None and rsi >= config.overextended_rsi
    )
    if resistance is None:
        # På eller over kjent topp: åpent rom, men også risiko for at utbruddet
        # allerede har skjedd.
        if overextended or week > 0.10:
            return "overstrukket"
        return "mulig"
    distance = resistance / stock.close - 1.0
    if distance <= config.breakout_distance:
        return "overstrukket" if overextended else "mulig"
    return "ikke nær"


def _categories(
    stock: Stock,
    config: ScoringConfig,
    signal: NewsSignal,
    breakout_status: str,
) -> tuple[str, ...]:
    categories: list[str] = []
    week = stock.week_return or 0.0
    month = stock.month_return
    stable_momentum = (
        week > 0
        and (month is None or month > 0)
        and stock.sma5 is not None
        and stock.sma20 is not None
        and stock.close > stock.sma5
        and stock.close > stock.sma20
        and week <= config.overextended_week
        and (stock.rsi is None or stock.rsi < config.overextended_rsi)
    )
    if stable_momentum:
        categories.append("momentum")
    if breakout_status == "mulig":
        categories.append("breakout")
    if (
        signal.is_relevant
        and signal.sentiment == "positive"
        and signal.event_type != "capital_raise"
    ):
        categories.append("news")
    return tuple(categories)


def _opportunity_components(
    stock: Stock,
    context: ScoringContext,
    signal: NewsSignal,
    config: ScoringConfig,
) -> dict[str, float]:
    week = stock.week_return or 0.0
    month = stock.month_return
    week_score = _clamp(week / 0.08)
    if week > config.overextended_week:
        week_score *= max(0.25, 1.0 - (week - config.overextended_week) / 0.10)
    month_score = _clamp((month or 0.0) / 0.20) if month is not None else 0.35
    momentum = 0.70 * week_score + 0.30 * month_score

    trend = 0.0
    if stock.sma20 and stock.sma20 > 0:
        distance = stock.close / stock.sma20 - 1.0
        trend = _clamp(distance / 0.08)
        if distance > 0.12:
            trend *= max(0.3, 1.0 - (distance - 0.12) / 0.15)
    if stock.sma5 and stock.sma20 and stock.sma5 > stock.sma20:
        trend = _clamp(trend + 0.12)
    if stock.sma50 and stock.close > stock.sma50:
        trend = _clamp(trend + 0.12)

    quarter = stock.quarter_return
    if quarter is None:
        quarter_score = 0.4
    else:
        base = context.median_quarter_return or 0.0
        quarter_score = _clamp(0.5 + (quarter - base) / 0.20)
    base_week = context.median_week_return or 0.0
    week_relative = _clamp(0.5 + (week - base_week) / 0.10)
    relative_strength = 0.60 * quarter_score + 0.40 * week_relative

    turnover = stock.average_turnover
    if turnover and turnover > 0:
        liquidity = _clamp(math.log10(turnover / 1_000_000.0) / 2.0)
    else:
        liquidity = 0.30

    ratio = _volume_ratio(stock)
    if ratio is None:
        volume = 0.40
    else:
        volume = _clamp((ratio - 0.4) / 1.2)
        if ratio > 3.0:
            volume *= max(0.4, 1.0 - (ratio - 3.0) / 5.0)

    resistance = _resistance(stock)
    if resistance is None:
        technical_upside = 0.70
    else:
        upside = resistance / stock.close - 1.0
        technical_upside = 0.45 if upside < 0.02 else _clamp(upside / 0.05)

    atr_pct = stock.atr_pct
    if atr_pct is None:
        volatility = 0.40
    else:
        volatility = 1.0 - min(
            abs(atr_pct - config.target_atr_pct) / max(config.target_atr_pct, 1e-9),
            1.0,
        )
        if atr_pct > 0.05:
            volatility *= max(0.2, 1.0 - (atr_pct - 0.05) / 0.05)

    breakout = 0.0
    resistance = _resistance(stock)
    near = resistance is None
    if resistance is not None:
        near = (resistance / stock.close - 1.0) <= config.breakout_distance
    consolidated = (
        -0.02 <= week <= 0.08
        and (atr_pct is None or atr_pct <= 0.04)
        and stock.sma20 is not None
        and stock.close > stock.sma20
    )
    volume_support = ratio is not None and 0.8 <= ratio <= 2.5
    breakout = (0.4 if near else 0.0) + (0.3 if consolidated else 0.0) + (
        0.3 if volume_support else 0.0
    )
    if week > config.overextended_week or (
        stock.rsi is not None and stock.rsi >= config.overextended_rsi
    ):
        breakout *= 0.25

    return {
        "momentum": momentum,
        "trend": trend,
        "relative_strength": relative_strength,
        "liquidity": liquidity,
        "volume": volume,
        "technical_upside": technical_upside,
        "volatility": volatility,
        "news": _news_opportunity(signal),
        "breakout": breakout,
    }


def _risk_components(
    stock: Stock,
    signal: NewsSignal,
    today: date,
    config: ScoringConfig,
) -> dict[str, float]:
    atr_pct = stock.atr_pct
    if atr_pct is None:
        volatility = 0.5
    else:
        volatility = _clamp((atr_pct - 0.015) / 0.055)

    week = stock.week_return or 0.0
    overextension_values = [
        _clamp((week - 0.10) / 0.15),
    ]
    if stock.rsi is not None:
        overextension_values.append(_clamp((stock.rsi - 65.0) / 20.0))
    if stock.sma20 and stock.sma20 > 0:
        overextension_values.append(
            _clamp(((stock.close / stock.sma20 - 1.0) - 0.08) / 0.15)
        )
    if stock.month_return is not None:
        overextension_values.append(_clamp((stock.month_return - 0.30) / 0.20))
    overextension = max(overextension_values)

    turnover = stock.average_turnover
    if turnover is None:
        liquidity = 0.60
    elif turnover < 5_000_000:
        liquidity = 1.0
    elif turnover < 10_000_000:
        liquidity = 0.70
    elif turnover < 30_000_000:
        liquidity = 0.40
    elif turnover < 100_000_000:
        liquidity = 0.15
    else:
        liquidity = 0.0

    event = 0.0
    earnings = days_until(stock.earnings_date, today)
    if earnings is not None and 0 <= earnings <= 7:
        event = max(
            event,
            {0: 1.0, 1: 0.85, 2: 0.55, 3: 0.35}.get(earnings, 0.15),
        )
    ex_date = days_until(stock.ex_dividend_date, today)
    if ex_date is not None and 0 <= ex_date <= 1:
        event = max(event, 0.5 if ex_date == 0 else 0.3)

    cap = stock.market_cap
    if cap is None:
        market_cap = 0.30
    elif cap < 300_000_000:
        market_cap = 1.0
    elif cap < 1_000_000_000:
        market_cap = 0.65
    elif cap < 3_000_000_000:
        market_cap = 0.35
    elif cap < 10_000_000_000:
        market_cap = 0.10
    else:
        market_cap = 0.0

    price = stock.close
    if price < 10:
        price_risk = 1.0
    elif price < 20:
        price_risk = 0.65
    elif price < 50:
        price_risk = 0.25
    elif price < 100:
        price_risk = 0.10
    else:
        price_risk = 0.0

    if stock.spread_pct is None:
        spread = 0.20
    elif stock.spread_pct > 0.005:
        spread = 1.0
    elif stock.spread_pct > 0.0025:
        spread = 0.6
    elif stock.spread_pct > 0.0015:
        spread = 0.3
    else:
        spread = 0.0

    return {
        "volatility": volatility,
        "overextension": overextension,
        "liquidity": liquidity,
        "event": event,
        "negative_news": _news_risk(signal),
        "market_cap": market_cap,
        "price": price_risk,
        "spread": spread,
    }


def _reasons(stock: Stock) -> tuple[str, ...]:
    reasons = [
        f"Uke {format_pct(stock.week_return)}",
        f"Måned {format_pct(stock.month_return)}",
    ]
    if stock.sma20:
        trend_pct = (stock.close / stock.sma20 - 1.0) * 100.0
        reasons.append(f"{trend_pct:+.1f} % over SMA20".replace(".", ","))
    if stock.rsi is not None:
        reasons.append(f"RSI {stock.rsi:.0f}")
    if stock.average_turnover is not None:
        reasons.append(f"{format_market_cap(stock.average_turnover)}/dag")
    if stock.atr_pct is not None:
        reasons.append(f"ATR {stock.atr_pct * 100.0:.1f} %".replace(".", ","))
    return tuple(reasons)


def _warnings(
    stock: Stock,
    signal: NewsSignal,
    today: date,
    breakout_status: str,
) -> tuple[str, ...]:
    warnings: list[str] = []

    earnings = days_until(stock.earnings_date, today)
    if earnings == 0:
        warnings.append("Resultat i dag")
    elif earnings == 1:
        warnings.append("Resultat i morgen")
    elif earnings is not None and 2 <= earnings <= 7:
        warnings.append(f"Resultat om {earnings} dager")

    ex_date = days_until(stock.ex_dividend_date, today)
    if ex_date == 0:
        warnings.append("Ex-dato i dag")
    elif ex_date == 1:
        warnings.append("Ex-dato i morgen")

    if stock.rsi is not None and stock.rsi >= 75:
        warnings.append("RSI over 75 – overopphetet")
    if (stock.week_return or 0.0) > 0.15:
        warnings.append("Sterk uke – fare for pause")
    if breakout_status == "overstrukket":
        warnings.append("Nær høy, men allerede strukket")
    if stock.close < 10.0:
        warnings.append("Kurs under 10 kr – større relativ spread")
    if stock.average_turnover is None:
        warnings.append("Likviditet ukjent")
    elif stock.average_turnover < 10_000_000.0:
        warnings.append("Lav likviditet")
    if stock.market_cap is not None and stock.market_cap < 1_000_000_000.0:
        warnings.append("Liten markedsverdi")
    if stock.month_return is None:
        warnings.append("Månedstrend mangler")
    if signal.event_type == "capital_raise":
        warnings.append("Emisjon/kapitalinnhenting – utvanningsrisiko")
    elif signal.sentiment == "negative" and signal.is_relevant:
        warnings.append("Negativ nyhet – sjekk kilden")
    elif signal.sentiment == "mixed" and signal.is_relevant:
        warnings.append("Blandet nyhetsbilde")
    if stock.spread_pct is None:
        warnings.append("Spread ikke tilgjengelig – sjekk etter åpning")
    elif stock.spread_pct > 0.005:
        warnings.append("Stor spread – bruk limit og vurder å stå over")
    elif stock.spread_pct > 0.0025:
        warnings.append("Spread over 0,25 % – sjekk etter åpning")

    return tuple(warnings)


def _build_candidate(
    stock: Stock,
    context: ScoringContext,
    signal: NewsSignal,
    today: date,
    config: ScoringConfig,
) -> Candidate:
    opportunity_components = _opportunity_components(stock, context, signal, config)
    risk_components = _risk_components(stock, signal, today, config)
    opportunity = 100.0 * _weighted(opportunity_components, config.weights)
    risk = 100.0 * _weighted(risk_components, config.risk_weights)
    score = _clamp(
        opportunity * (1.0 - config.risk_penalty * risk / 100.0),
        0.0,
        100.0,
    )
    breakout_status = _breakout_status(stock, config, signal)
    categories = _categories(stock, config, signal, breakout_status)
    resistance = _resistance(stock)
    support = _support(stock)
    upside = resistance / stock.close - 1.0 if resistance else None
    return Candidate(
        stock=stock,
        score=score,
        reasons=_reasons(stock),
        warnings=_warnings(stock, signal, today, breakout_status),
        opportunity_score=opportunity,
        risk_score=risk,
        categories=categories,
        news_signal=signal,
        breakout_status=breakout_status,
        technical_upside=upside,
        resistance=resistance,
        support=support,
        volume_ratio=_volume_ratio(stock),
    )


def rank_candidates(
    stocks: Iterable[Stock],
    limit: int = 5,
    today: Optional[date] = None,
    news: Optional[NewsFeed] = None,
    config: Optional[ScoringConfig] = None,
) -> list[Candidate]:
    """Rangerer aksjene og returnerer de beste kandidatene."""
    cfg = config or ScoringConfig()
    if today is None:
        today = date.today()
    items = list(stocks)
    context = _context(items)
    candidates = [
        _build_candidate(
            stock,
            context,
            news.signal_for(stock) if news is not None else NewsSignal(),
            today,
            cfg,
        )
        for stock in items
        if is_candidate(stock, cfg)
    ]
    candidates.sort(
        key=lambda candidate: (
            -candidate.score,
            candidate.risk_score,
            -candidate.opportunity_score,
            -(candidate.stock.week_return or 0.0),
            candidate.stock.ticker,
        )
    )
    return candidates[: max(0, limit)]
