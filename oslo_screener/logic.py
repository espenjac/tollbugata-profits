"""Selve screen-logikken: trend, all-time high og filtrering."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable, Optional

from .models import Stock


@dataclass(frozen=True)
class Criteria:
    """Kriteriene som avgjør om en aksje havner i listen."""

    min_week_return: float = 0.0  # brøk, 0.0 = positiv uke
    ath_margin: float = 0.01  # 0.01 = inntil 1 % under ATH regnes som «på ATH»
    require_above_sma5: bool = True
    require_above_sma20: bool = False
    min_market_cap: float = 0.0
    min_turnover: float = 0.0
    include_types: tuple[str, ...] = ("stock", "dr")
    allow_unknown_ath: bool = False
    include_at_high: bool = True  # ta med aksjer på/ved ATH, men merk dem tydelig
    # Euronext Growth er normalt ikke tilgjengelig på ASK. Skjules som standard.
    exclude_growth: bool = True


@dataclass
class ScreenResult:
    """Treffene og hvorfor resten ble filtrert bort."""

    matches: list[Stock]
    universe_size: int
    excluded: Counter[str] = field(default_factory=Counter)
    at_high_count: int = 0

    @property
    def match_count(self) -> int:
        return len(self.matches)


EXCLUSION_LABELS: dict[str, str] = {
    "euronext growth": "Euronext Growth (ikke ASK)",
    "ikke aksje": "Ikke aksje/DR",
    "mangler ukedata": "Mangler ukedata",
    "svak uke": "Ikke positiv uke",
    "under SMA5": "Under SMA5",
    "under SMA20": "Under SMA20",
    "for lav markedsverdi": "For lav markedsverdi",
    "for lavt omsetningsvolum": "For lavt volum",
    "på/ved ATH": "På/ved all-time high",
    "ukjent ATH": "Ukjent ATH",
    "ATH usikker": "ATH usikker (splitt?)",
}


def is_at_high(stock: Stock, criteria: Criteria) -> bool:
    """Om aksjen er på/ved all-time high i henhold til ATH-marginen."""
    if not stock.ath_is_reliable:
        return False
    ref = stock.reference_ath
    if ref is None:
        return False
    return stock.close >= ref * (1.0 - criteria.ath_margin)


def evaluate(stock: Stock, criteria: Criteria) -> tuple[bool, str]:
    """Returnerer (passerer, årsak). Årsaken er tom når aksjen passerer."""
    if criteria.exclude_growth and stock.is_growth:
        return False, "euronext growth"

    if stock.instrument_type not in criteria.include_types:
        return False, "ikke aksje"

    if stock.week_return is None:
        return False, "mangler ukedata"
    if stock.week_return <= criteria.min_week_return:
        return False, "svak uke"

    if criteria.require_above_sma5:
        if stock.sma5 is None or stock.close <= stock.sma5:
            return False, "under SMA5"

    if criteria.require_above_sma20:
        if stock.sma20 is None or stock.close <= stock.sma20:
            return False, "under SMA20"

    if criteria.min_market_cap > 0:
        if stock.market_cap is None or stock.market_cap < criteria.min_market_cap:
            return False, "for lav markedsverdi"

    if criteria.min_turnover > 0:
        turnover = stock.turnover
        if turnover is None or turnover < criteria.min_turnover:
            return False, "for lavt omsetningsvolum"

    ref = stock.reference_ath
    if ref is None:
        if criteria.allow_unknown_ath:
            return True, ""
        return False, "ukjent ATH"

    near_ath = stock.close >= ref * (1.0 - criteria.ath_margin)

    if not stock.ath_is_reliable:
        if criteria.allow_unknown_ath:
            return True, ""
        if near_ath:
            return False, "ukjent ATH" if stock.ath is None or stock.ath <= 0 else "ATH usikker"
        # ATH-tallet er trolig forurenset av splitt. Vi kan likevel trygt
        # inkludere dersom kursen ligger klart under 52-ukershøyeste, fordi
        # ATH alltid er minst like høyt som 52-ukershøyeste.
        high_52w = stock.high_52w
        if high_52w and high_52w > 0 and stock.close < high_52w * (1.0 - criteria.ath_margin):
            return True, ""
        return False, "ATH usikker"

    # Nær nok ATH (eller over).
    if near_ath:
        if criteria.include_at_high:
            # Tas med, men merkes som ATH i visningen.
            return True, ""
        return False, "på/ved ATH"

    return True, ""


def screen(stocks: Iterable[Stock], criteria: Criteria) -> ScreenResult:
    matches: list[Stock] = []
    excluded: Counter[str] = Counter()
    at_high_count = 0
    universe = 0
    for stock in stocks:
        universe += 1
        passed, reason = evaluate(stock, criteria)
        if passed:
            matches.append(stock)
            if is_at_high(stock, criteria):
                at_high_count += 1
        else:
            excluded[reason] += 1
    return ScreenResult(
        matches=matches,
        universe_size=universe,
        excluded=excluded,
        at_high_count=at_high_count,
    )


SORT_FIELDS = ("week", "month", "market_cap", "ath_distance", "name", "ticker")


def _sort_value(stock: Stock, field_name: str) -> Optional[float]:
    if field_name == "week":
        return stock.week_return
    if field_name == "month":
        return stock.month_return
    if field_name == "market_cap":
        return stock.market_cap
    if field_name == "ath_distance":
        return stock.distance_to_ath
    return None


def sort_stocks(stocks: Iterable[Stock], field_name: str = "week") -> list[Stock]:
    """Sorterer treffene. Ukjent verdi havner alltid nederst."""
    if field_name not in SORT_FIELDS:
        raise ValueError(f"Ukjent sorteringsfelt: {field_name}")

    items = list(stocks)
    if field_name in ("name", "ticker"):
        return sorted(items, key=lambda s: (getattr(s, field_name).casefold(), s.ticker))

    descending = field_name in ("week", "month", "market_cap", "ath_distance")
    sentinel = float("-inf") if descending else float("inf")

    def key(stock: Stock) -> float:
        value = _sort_value(stock, field_name)
        return sentinel if value is None else value

    return sorted(items, key=key, reverse=descending)


def describe_criteria(criteria: Criteria) -> str:
    """Kort, menneskelig beskrivelse av kriteriene."""
    parts = [f"ukeavkastning > {criteria.min_week_return * 100:.1f} %".replace(".", ",")]
    if criteria.require_above_sma5:
        parts.append("kurs > SMA5")
    if criteria.require_above_sma20:
        parts.append("kurs > SMA20")
    if criteria.include_at_high:
        parts.append(f"ATH-aksjer merkes (margin {criteria.ath_margin * 100:.1f} %)".replace(".", ","))
    else:
        parts.append(f"minst {criteria.ath_margin * 100:.1f} % under ATH".replace(".", ","))
    parts.append(
        "Euronext Growth skjult" if criteria.exclude_growth else "Euronext Growth med"
    )
    if criteria.min_market_cap > 0:
        parts.append(f"markedsverdi ≥ {criteria.min_market_cap / 1e9:.1f} mrd".replace(".", ","))
    if criteria.min_turnover > 0:
        parts.append(f"omsetning ≥ {criteria.min_turnover / 1e6:.1f} mill".replace(".", ","))
    return " · ".join(parts)
