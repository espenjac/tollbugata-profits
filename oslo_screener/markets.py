"""Markedssegmenter for Oslo-noterte aksjer.

TradingView bruker samme børskode (``OSL``) for både Oslo Børs, Euronext
Expand og Euronext Growth. For å kunne skjule Euronext Growth – som normalt
ikke kan holdes på aksjesparekonto (ASK) – henter vi den offisielle listen fra
Euronext Live og cacher den lokalt.

Kilden er uoffisiell og kan endre seg. Hvis listen ikke kan hentes, fortsetter
screeningen, men da med en tydelig advarsel om at Euronext Growth-aksjer kan
være med i resultatet.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

GROWTH_URL = (
    "https://live.euronext.com/en/product_directory/"
    "data/stocks-oslo-euronext-growth-"
)
GROWTH_QUERY = {"mics": "MERK", "page": "0", "pageSize": "10000"}
DEFAULT_GROWTH_CACHE_PATH = (
    Path(__file__).resolve().parent.parent / ".cache" / "euronext_growth.json"
)
DEFAULT_GROWTH_TTL = 24 * 60 * 60  # sekunder


class MarketDataSourceError(RuntimeError):
    """Klarte ikke å hente listen over Euronext Growth-aksjer."""


@dataclass(frozen=True)
class GrowthList:
    """Euronext Growth-tickere med metadata om hvor listen kommer fra."""

    tickers: frozenset[str]
    fetched_at: datetime
    source: str  # "live", "cache", "stale-cache" eller "error"
    warning: Optional[str] = None


def normalize_ticker(value: object) -> str:
    """Normaliserer tickere for trygg sammenligning på tvers av kilder."""
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def parse_growth_payload(payload: dict[str, Any]) -> frozenset[str]:
    """Plukker tickerne ut av Euronext Lives JSON-svar. Ingen nettverkstilgang."""
    rows = payload.get("aaData")
    if not isinstance(rows, list):
        raise MarketDataSourceError(
            "Svaret fra Euronext mangler listen over Euronext Growth-aksjer."
        )

    tickers: set[str] = set()
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 3:
            continue
        # Euronext-svaret har markedsnavnet i fjerde kolonne, ofte inne i HTML.
        # Filtrer bort andre segmenter dersom svaret skulle være blandet.
        market = str(row[3]) if len(row) > 3 else ""
        if market and "growth" not in market.casefold():
            continue
        ticker = normalize_ticker(row[2])
        if ticker:
            tickers.add(ticker)

    total = payload.get("iTotalRecords")
    try:
        expected = int(total) if total is not None else None
    except (TypeError, ValueError):
        expected = None
    if expected is not None and len(rows) < expected:
        raise MarketDataSourceError(
            f"Ufullstendig Euronext Growth-liste: fikk {len(rows)} av {expected} rader."
        )
    if not tickers:
        raise MarketDataSourceError(
            "Euronext Growth-listen var tom eller hadde uventet format."
        )
    return frozenset(tickers)


def _fetch_growth_payload(timeout: float) -> dict[str, Any]:
    url = f"{GROWTH_URL}?{urllib.parse.urlencode(GROWTH_QUERY)}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
                "TollbugataProfits/1.0"
            ),
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    if not raw:
        raise MarketDataSourceError("Euronext returnerte et tomt svar.")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MarketDataSourceError(f"Ugyldig JSON fra Euronext: {exc}") from exc
    if not isinstance(payload, dict):
        raise MarketDataSourceError("Uventet svarformat fra Euronext.")
    return payload


def _fetch_growth_with_retry(timeout: float, retries: int) -> dict[str, Any]:
    last_error: Optional[Exception] = None
    for attempt in range(1, max(1, retries) + 1):
        try:
            return _fetch_growth_payload(timeout=timeout)
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            OSError,
            MarketDataSourceError,
        ) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(min(2 ** (attempt - 1), 4))
    raise MarketDataSourceError(
        f"Kunne ikke hente Euronext Growth-listen: {last_error}"
    ) from last_error


def _read_cache(path: Path) -> Optional[tuple[float, frozenset[str]]]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            cached = json.load(handle)
        fetched_at = float(cached["fetched_at"])
        raw_tickers = cached["tickers"]
        if not isinstance(raw_tickers, list):
            return None
        tickers = frozenset(
            ticker
            for ticker in (normalize_ticker(value) for value in raw_tickers)
            if ticker
        )
        if not tickers:
            return None
        return fetched_at, tickers
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _write_cache(path: Path, tickers: frozenset[str]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(
                {"fetched_at": time.time(), "tickers": sorted(tickers)},
                handle,
                ensure_ascii=False,
            )
        tmp.replace(path)
    except OSError:
        # Cache er en optimalisering, ikke et krav.
        pass


def _to_datetime(timestamp: float) -> datetime:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc)


def fetch_growth_tickers(
    cache_ttl: float = DEFAULT_GROWTH_TTL,
    force: bool = False,
    timeout: float = 30.0,
    retries: int = 3,
    cache_path: Optional[Path] = None,
) -> GrowthList:
    """Henter tickere på Euronext Growth, med cache og myk feilhåndtering.

    Feil kaster ikke videre: screeningen skal kunne kjøre selv om Euronext
    Live er utilgjengelig. Da returneres en tom liste og en advarsel, slik at
    brukeren vet at filtreringen ikke er komplett.
    """
    path = cache_path or DEFAULT_GROWTH_CACHE_PATH
    cached = _read_cache(path)
    now = time.time()

    if cached and not force and now - cached[0] <= cache_ttl:
        fetched_at, tickers = cached
        return GrowthList(
            tickers=tickers,
            fetched_at=_to_datetime(fetched_at),
            source="cache",
        )

    try:
        payload = _fetch_growth_with_retry(timeout=timeout, retries=retries)
        tickers = parse_growth_payload(payload)
    except MarketDataSourceError as exc:
        if cached:
            fetched_at, tickers = cached
            return GrowthList(
                tickers=tickers,
                fetched_at=_to_datetime(fetched_at),
                source="stale-cache",
                warning=(
                    f"Fersk Euronext Growth-liste kunne ikke hentes ({exc}). "
                    f"Bruker cache fra {_to_datetime(fetched_at).astimezone():%d.%m.%Y %H:%M}; "
                    "nye eller endrede segmenter kan mangle."
                ),
            )
        return GrowthList(
            tickers=frozenset(),
            fetched_at=datetime.now(timezone.utc),
            source="error",
            warning=(
                f"Euronext Growth-listen kunne ikke hentes ({exc}). "
                "Aksjer på Euronext Growth kan derfor være med i listen."
            ),
        )

    _write_cache(path, tickers)
    return GrowthList(
        tickers=tickers,
        fetched_at=datetime.now(timezone.utc),
        source="live",
    )
