"""Teknisk rangering av kortsiktige kandidater.

Dette er en enkel, gjennomsiktig poengmodell – ikke et kjøpssignal og ikke
investeringsråd. Den kombinerer momentum, trend, likviditet, volatilitet og
RSI, og trekker fra for kjente risikofaktorer som resultat/ex-dato samme dag
eller i morgen, lav likviditet og overopphetet kurs.

Modellen er laget for å gi en kort watchlist til dagshandel, ikke for å
forutsi avkastning. Brukeren må selv bekrefte volum, spread og retning etter
børsåpning.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

from .formatting import days_until, format_market_cap, format_pct
from .models import Stock

# Konservative minstekrav for at en aksje skal vurderes i topplisten.
MIN_PRICE = 5.0
MIN_MARKET_CAP = 300_000_000.0  # 300 mill. NOK
MIN_AVERAGE_TURNOVER = 5_000_000.0  # 5 mill. NOK per dag
MAX_WEEK_RETURN = 0.25  # over 25 % på en uke regnes som for hett

# Ideell ATR for dagshandel: rundt 2,5 % av kursen. For lavt gir lite
# bevegelse, for høyt gir stor risiko og ofte bredere spread.
TARGET_ATR_PCT = 0.025


@dataclass(frozen=True)
class Candidate:
    """En rangert kandidat med begrunnelse og risikomerknader."""

    stock: Stock
    score: float
    reasons: tuple[str, ...]
    warnings: tuple[str, ...]


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def is_candidate(stock: Stock) -> bool:
    """Grovsiler bort aksjer som er dårlig egnet for kortsiktig handel."""
    if stock.instrument_type not in ("stock", "dr"):
        return False
    if stock.week_return is None or stock.week_return <= 0:
        return False
    if stock.week_return > MAX_WEEK_RETURN:
        return False
    if stock.close < MIN_PRICE:
        return False
    if stock.sma5 is None or stock.close <= stock.sma5:
        return False
    if stock.sma20 is None or stock.close <= stock.sma20:
        return False
    if stock.month_return is not None and stock.month_return <= 0:
        return False
    if stock.rsi is not None and stock.rsi > 82:
        return False
    if stock.market_cap is not None and stock.market_cap < MIN_MARKET_CAP:
        return False
    turnover = stock.average_turnover
    if turnover is not None and turnover < MIN_AVERAGE_TURNOVER:
        return False
    return True


def _score(stock: Stock, today: date) -> float:
    """Poeng fra 0 til 100. Høyere er bedre, men aldri et kjøpssignal."""
    momentum = _clamp((stock.week_return or 0.0) / 0.10)
    month = _clamp((stock.month_return or 0.0) / 0.20)
    trend = (
        _clamp((stock.close / stock.sma20 - 1.0) / 0.10)
        if stock.sma20
        else 0.0
    )

    turnover = stock.average_turnover
    if turnover and turnover > 0:
        liquidity = _clamp(math.log10(turnover / 1_000_000.0) / 2.0)
    else:
        liquidity = 0.35  # ukjent likviditet får en nøytral, lav score

    atr_pct = stock.atr_pct
    if atr_pct is None:
        volatility = 0.5
    else:
        volatility = 1.0 - min(abs(atr_pct - TARGET_ATR_PCT) / TARGET_ATR_PCT, 1.0)

    if stock.rsi is None:
        rsi_fit = 0.5
    else:
        rsi_fit = 1.0 - min(abs(stock.rsi - 62.0) / 25.0, 1.0)

    score = 100.0 * (
        0.30 * momentum
        + 0.15 * month
        + 0.20 * trend
        + 0.20 * liquidity
        + 0.10 * volatility
        + 0.05 * rsi_fit
    )

    if stock.rsi is not None:
        if stock.rsi >= 75:
            score -= 10.0
        elif stock.rsi <= 45:
            score -= 5.0

    if (stock.week_return or 0.0) > 0.15:
        score -= 5.0
    if stock.close < 10.0:
        score -= 10.0
    if turnover is not None and turnover < 10_000_000.0:
        score -= 8.0
    if stock.market_cap is not None and stock.market_cap < 1_000_000_000.0:
        score -= 5.0

    earnings = days_until(stock.earnings_date, today)
    if earnings is not None and 0 <= earnings <= 1:
        score -= 10.0
    ex_date = days_until(stock.ex_dividend_date, today)
    if ex_date is not None and 0 <= ex_date <= 1:
        score -= 8.0

    return _clamp(score, 0.0, 100.0)


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


def _warnings(stock: Stock, today: date) -> tuple[str, ...]:
    warnings: list[str] = []

    earnings = days_until(stock.earnings_date, today)
    if earnings == 0:
        warnings.append("Resultat i dag")
    elif earnings == 1:
        warnings.append("Resultat i morgen")

    ex_date = days_until(stock.ex_dividend_date, today)
    if ex_date == 0:
        warnings.append("Ex-dato i dag")
    elif ex_date == 1:
        warnings.append("Ex-dato i morgen")

    if stock.rsi is not None and stock.rsi >= 75:
        warnings.append("RSI over 75 – overopphetet")
    if (stock.week_return or 0.0) > 0.15:
        warnings.append("Sterk uke – fare for pause")
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

    return tuple(warnings)


def rank_candidates(
    stocks: Iterable[Stock],
    limit: int = 5,
    today: Optional[date] = None,
) -> list[Candidate]:
    """Rangerer aksjene og returnerer de beste kandidatene."""
    if today is None:
        today = date.today()

    candidates = [
        Candidate(
            stock=stock,
            score=_score(stock, today),
            reasons=_reasons(stock),
            warnings=_warnings(stock, today),
        )
        for stock in stocks
        if is_candidate(stock)
    ]
    candidates.sort(
        key=lambda candidate: (
            -candidate.score,
            -(candidate.stock.week_return or 0.0),
            candidate.stock.ticker,
        )
    )
    return candidates[: max(0, limit)]
