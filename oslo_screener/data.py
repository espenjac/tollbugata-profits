"""Henting og parsing av Oslo Børs-data fra TradingView-scanneren.

TradingView har et uoffisielt, åpent scanner-endepunkt som gir oss hele
Oslo Børs i ett kall – uten API-nøkkel. Endepunktet kan endre seg uten
varsel; derfor caches svaret lokalt og feilmeldingene er tydelige.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from .markets import (
    DEFAULT_GROWTH_CACHE_PATH,
    DEFAULT_GROWTH_TTL,
    fetch_growth_tickers,
    normalize_ticker,
)
from .models import Stock

try:
    _OSLO = ZoneInfo("Europe/Oslo")
except Exception:  # pragma: no cover - mangler tidssonedata
    _OSLO = timezone.utc

SCANNER_URL = "https://scanner.tradingview.com/norway/scan"

# Rekkefølgen må samsvare med kolonnene vi ber om. Vi leser likevel svaret
# som et navngitt kart, slik at en ekstra kolonne ikke velter parsingen.
COLUMNS = [
    "name",
    "description",
    "close",
    "currency",
    "change",
    "Perf.W",
    "Perf.1M",
    "Perf.3M",
    "Perf.6M",
    "Perf.Y",
    "SMA5",
    "SMA20",
    "SMA50",
    "SMA200",
    "RSI",
    "High.All",
    "price_52_week_high",
    "volume",
    "average_volume_10d_calc",
    "market_cap_basic",
    "sector",
    "exchange",
    "type",
    "typespecs",
    "earnings_release_next_date",
    "dividend_ex_date_upcoming",
    "ATR",
]

DEFAULT_CACHE_PATH = Path(__file__).resolve().parent.parent / ".cache" / "oslo_bors_scan.json"
DEFAULT_CACHE_TTL = 600  # sekunder


class DataSourceError(RuntimeError):
    """Klarte ikke å hente data fra kilden."""


@dataclass(frozen=True)
class Universe:
    """Resultatet av en datahenting."""

    stocks: list[Stock]
    fetched_at: datetime
    source: str  # "live", "cache" eller "stale-cache"
    warning: Optional[str] = None
    growth_tickers: frozenset[str] = frozenset()
    growth_source: str = "ukjent"  # "live", "cache", "stale-cache" eller "error"
    growth_warning: Optional[str] = None


def _scanner_payload() -> dict[str, Any]:
    return {
        "filter": [{"left": "exchange", "operation": "equal", "right": "OSL"}],
        "options": {"lang": "en"},
        "columns": COLUMNS,
        "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
        "range": [0, 1000],
    }


def _post_scanner(timeout: float = 30.0) -> dict[str, Any]:
    body = json.dumps(_scanner_payload()).encode("utf-8")
    request = urllib.request.Request(
        SCANNER_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
                "TollbugataProfits/1.0"
            ),
            "Origin": "https://www.tradingview.com",
            "Referer": "https://www.tradingview.com/markets/stocks-norway/market-movers-all-stocks/",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    if not raw:
        raise DataSourceError("TradingView returnerte et tomt svar.")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DataSourceError(f"Ugyldig JSON fra TradingView: {exc}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise DataSourceError("Uventet svarformat fra TradingView-scanneren.")
    return payload


def _fetch_with_retry(timeout: float, retries: int) -> dict[str, Any]:
    last_error: Optional[Exception] = None
    for attempt in range(1, max(1, retries) + 1):
        try:
            return _post_scanner(timeout=timeout)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, DataSourceError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(min(2 ** (attempt - 1), 4))
    raise DataSourceError(f"Kunne ikke hente data fra TradingView: {last_error}") from last_error


def _number(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


def _percent(value: Any) -> Optional[float]:
    """TradingView oppgir avkastning i prosentpoeng; vi lagrer som brøk."""
    number = _number(value)
    return None if number is None else number / 100.0


def _date(value: Any) -> Optional[date]:
    """TradingView-dato (Unix-tid eller ISO-tekst) til norsk dato."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp <= 0:
            return None
        if timestamp > 1e11:  # millisekunder
            timestamp /= 1000.0
        try:
            return (
                datetime.fromtimestamp(timestamp, tz=timezone.utc)
                .astimezone(_OSLO)
                .date()
            )
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            pass
        try:
            return _date(float(text))
        except ValueError:
            return None
    return None


def parse_payload(
    payload: dict[str, Any],
    growth_tickers: Optional[Iterable[str]] = None,
) -> list[Stock]:
    """Gjør et scanner-svar om til Stock-objekter. Ingen nettverkstilgang.

    ``growth_tickers`` er tickere fra Euronext Growth. De merkes med
    ``market="euronext_growth"`` slik at screenen kan skjule dem.
    """
    rows = payload.get("data")
    if not isinstance(rows, list):
        raise DataSourceError("Svar fra TradingView mangler 'data'-listen.")

    growth = {
        ticker
        for ticker in (normalize_ticker(value) for value in (growth_tickers or ()))
        if ticker
    }
    stocks: list[Stock] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw_values = row.get("d")
        if not isinstance(raw_values, list):
            continue
        values = dict(zip(COLUMNS, raw_values))

        symbol = str(row.get("s") or "")
        ticker = str(values.get("name") or symbol.split(":")[-1]).strip()
        if not ticker:
            continue

        close = _number(values.get("close"))
        if close is None or close <= 0:
            continue

        name = str(values.get("description") or ticker).strip()
        currency = str(values.get("currency") or "NOK").strip()
        sector = str(values.get("sector") or "Ukjent").strip()
        instrument_type = str(values.get("type") or "stock").strip()
        market = "euronext_growth" if normalize_ticker(ticker) in growth else "oslo"

        stocks.append(
            Stock(
                ticker=ticker,
                name=name,
                close=close,
                currency=currency,
                day_return=_percent(values.get("change")),
                week_return=_percent(values.get("Perf.W")),
                month_return=_percent(values.get("Perf.1M")),
                quarter_return=_percent(values.get("Perf.3M")),
                sma5=_number(values.get("SMA5")),
                sma20=_number(values.get("SMA20")),
                sma50=_number(values.get("SMA50")),
                rsi=_number(values.get("RSI")),
                ath=_number(values.get("High.All")),
                high_52w=_number(values.get("price_52_week_high")),
                market_cap=_number(values.get("market_cap_basic")),
                volume=_number(values.get("volume")),
                sector=sector,
                instrument_type=instrument_type,
                market=market,
                earnings_date=_date(values.get("earnings_release_next_date")),
                ex_dividend_date=_date(values.get("dividend_ex_date_upcoming")),
                average_volume_10d=_number(values.get("average_volume_10d_calc")),
                atr=_number(values.get("ATR")),
            )
        )
    return stocks


def _read_cache(path: Path) -> Optional[tuple[float, dict[str, Any]]]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            cached = json.load(handle)
        fetched_at = float(cached["fetched_at"])
        payload = cached["payload"]
        if not isinstance(payload, dict):
            return None
        return fetched_at, payload
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _write_cache(path: Path, payload: dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump({"fetched_at": time.time(), "payload": payload}, handle, ensure_ascii=False)
        tmp.replace(path)
    except OSError:
        # Cache er en optimalisering, ikke et krav.
        pass


def _to_datetime(timestamp: float) -> datetime:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc)


def _combine_warnings(*warnings: Optional[str]) -> Optional[str]:
    text = " ".join(warning for warning in warnings if warning)
    return text or None


def fetch_universe(
    cache_ttl: float = DEFAULT_CACHE_TTL,
    force: bool = False,
    timeout: float = 30.0,
    retries: int = 3,
    cache_path: Optional[Path] = None,
    growth_cache_ttl: float = DEFAULT_GROWTH_TTL,
    growth_cache_path: Optional[Path] = None,
) -> Universe:
    """Henter Oslo-noterte aksjer, med lokal cache og fallback til gammel cache.

    Euronext Growth hentes fra en egen offisiell liste fordi TradingView bruker
    samme børskode for alle Oslo-segmentene.
    """
    path = cache_path or DEFAULT_CACHE_PATH
    cached = _read_cache(path)
    now = time.time()
    growth = fetch_growth_tickers(
        cache_ttl=growth_cache_ttl,
        force=force,
        timeout=timeout,
        retries=retries,
        cache_path=growth_cache_path or DEFAULT_GROWTH_CACHE_PATH,
    )

    if cached and not force and now - cached[0] <= cache_ttl:
        fetched_at, payload = cached
        return Universe(
            stocks=parse_payload(payload, growth.tickers),
            fetched_at=_to_datetime(fetched_at),
            source="cache",
            warning=growth.warning,
            growth_tickers=growth.tickers,
            growth_source=growth.source,
            growth_warning=growth.warning,
        )

    try:
        payload = _fetch_with_retry(timeout=timeout, retries=retries)
    except DataSourceError as exc:
        if cached:
            fetched_at, payload = cached
            warning = (
                f"Ferske data kunne ikke hentes ({exc}). "
                f"Viser cache fra {_to_datetime(fetched_at).astimezone():%d.%m.%Y %H:%M}."
            )
            return Universe(
                stocks=parse_payload(payload, growth.tickers),
                fetched_at=_to_datetime(fetched_at),
                source="stale-cache",
                warning=_combine_warnings(warning, growth.warning),
                growth_tickers=growth.tickers,
                growth_source=growth.source,
                growth_warning=growth.warning,
            )
        raise

    _write_cache(path, payload)
    return Universe(
        stocks=parse_payload(payload, growth.tickers),
        fetched_at=_to_datetime(time.time()),
        source="live",
        warning=growth.warning,
        growth_tickers=growth.tickers,
        growth_source=growth.source,
        growth_warning=growth.warning,
    )
