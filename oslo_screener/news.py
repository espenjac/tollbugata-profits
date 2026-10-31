"""Børsmeldinger fra Oslo Børs NewsWeb.

NewsWeb har et åpent, uoffisielt API som gir alle meldinger for et datointervall.
Vi bruker det til å vise hvilke selskaper som har sendt melding siden forrige
handelsdag stengte. Tjenesten kan endre seg uten varsel; derfor caches svaret
lokalt og feil skal aldri stoppe selve aksjescreeningen.

Overskriftene får også en grov positiv/negativ/nøytral-markering basert på
stikkord. Det er et hjelpemiddel, ikke en vurdering av nyheten.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from .models import Stock

try:
    _OSLO = ZoneInfo("Europe/Oslo")
except Exception:  # pragma: no cover - mangler tidssonedata
    _OSLO = timezone.utc

NEWS_API_URL = "https://api3.oslo.oslobors.no/v1/newsreader/list"
NEWS_MESSAGE_URL = "https://newsweb.oslobors.no/message/{message_id}"
DEFAULT_NEWS_CACHE_PATH = (
    Path(__file__).resolve().parent.parent / ".cache" / "oslo_bors_news.json"
)
DEFAULT_NEWS_TTL = 300  # sekunder

# Norske ord som gjør det sannsynlig at en av to parallellmeldinger er den
# norske versjonen. NewsWeb publiserer ofte samme melding på norsk og engelsk.
_NORWEGIAN_HINTS = (
    " og ",
    " av ",
    " for ",
    " til ",
    " på ",
    " med ",
    " er ",
    " ikke ",
    " ny ",
    " nye ",
    " kvartal",
    " rapport",
    " resultat",
    " avtale",
    " kjøp",
    " salg",
    " oppkjøp",
    " kontrakt",
    " tildelt",
    " leverer",
    " sterk",
    " vekst",
    " utbytte",
    " emisjon",
    " meldepliktig",
    " primærinnsider",
    " nærstående",
    " egne aksjer",
    " ansatt",
)


class NewsSourceError(RuntimeError):
    """Klarte ikke å hente børsmeldinger."""


@dataclass(frozen=True)
class NewsItem:
    ticker: str
    issuer_name: str
    title: str
    published_at: datetime  # aware, Europe/Oslo
    category: str
    message_id: int
    url: str
    sentiment: str = "neutral"  # "positive", "negative" eller "neutral"


@dataclass(frozen=True)
class NewsFeed:
    """Meldinger gruppert per ticker, med start på nyhetsvinduet."""

    items_by_ticker: dict[str, tuple[NewsItem, ...]]
    items_by_name: dict[str, tuple[NewsItem, ...]]
    fetched_at: datetime
    since: datetime
    source: str  # "live", "cache", "stale-cache" eller "error"
    warning: Optional[str] = None
    session_open: Optional[datetime] = None

    @property
    def total_count(self) -> int:
        return sum(len(items) for items in self.items_by_ticker.values())

    @property
    def ticker_count(self) -> int:
        return len(self.items_by_ticker)

    def for_stock(self, stock: Stock) -> tuple[NewsItem, ...]:
        """Finn meldinger for en aksje, først på ticker og deretter på navn."""
        items = self.items_by_ticker.get(_ticker_key(stock.ticker))
        if items:
            return items
        return self.items_by_name.get(_name_key(stock.name), ())

    def for_ticker(self, ticker: str) -> tuple[NewsItem, ...]:
        return self.items_by_ticker.get(_ticker_key(ticker), ())

    def is_new_since_open(self, item: NewsItem) -> bool:
        return self.session_open is not None and item.published_at >= self.session_open

    def new_count(self, items: Iterable[NewsItem]) -> int:
        """Antall unike meldinger publisert etter dagens åpning."""
        return sum(1 for item in unique_news(items) if self.is_new_since_open(item))


def _as_oslo(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(_OSLO)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def last_market_open(now: Optional[datetime] = None) -> datetime:
    """Siste ordinære børsåpning (09:00 norsk tid) på en hverdag."""
    local = _as_oslo(now or datetime.now(timezone.utc))
    candidate = local.replace(hour=9, minute=0, second=0, microsecond=0)
    if local < candidate:
        candidate -= timedelta(days=1)
    while candidate.weekday() >= 5:  # lørdag eller søndag
        candidate -= timedelta(days=1)
    return candidate


def news_window_start(now: Optional[datetime] = None) -> datetime:
    """Start på nyhetsvinduet: forrige handelsdag stengte (16:30).

    Vinduet beholdes gjennom hele dagen og til midnatt, slik at nattens
    meldinger ikke forsvinner når børsen åpner kl. 09:00. På lørdag, søndag
    og mandag morgen betyr det fredag kl. 16:30.
    """
    local = _as_oslo(now or datetime.now(timezone.utc))
    day = local.date() - timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return datetime(day.year, day.month, day.day, 16, 30, tzinfo=local.tzinfo)


def current_session_open(now: Optional[datetime] = None) -> Optional[datetime]:
    """Dagens åpning hvis børsen har åpnet i dag, ellers None."""
    local = _as_oslo(now or datetime.now(timezone.utc))
    if local.weekday() >= 5:
        return None
    opened = local.replace(hour=9, minute=0, second=0, microsecond=0)
    return opened if local >= opened else None


# Enkel stikkordsanalyse. Dette er ikke en vurdering av nyheten, bare et
# hjelpemiddel for å skille grovt mellom positive, negative og nøytrale titler.
_POSITIVE_STRONG = (
    r"\brekord",
    r"\boverskudd",
    r"\bprofitt",
    r"\boppkjøp",
    r"\bkontrakt",
    r"\btildelt",
    r"\bsterk",
    r"\blønnsom",
    r"\bvekst",
    r"\bacqui",
    r"\brecords?\b",
    r"\bprofit",
    r"\bcontract",
    r"\bawarded",
    r"\bstrong(?:er|est)?\b",
    r"\bgrowth\b",
    r"\bbeat\b",
    r"\braised\b",
    r"\bupgrade",
)
_POSITIVE_WEAK = (
    r"\bgod\b",
    r"\bgode\b",
    r"\bavtale",
    r"\bagreement",
    r"\bkjøp",
    r"\bpurchase",
    r"\binngår",
    r"\bvinner",
    r"\bwins\b",
    r"\butbytte",
    r"\bdividend",
    r"\bbuyback",
    r"\brepurchase",
    r"\bimproved\b",
    r"\bsolid\b",
    r"\bexpands\b",
    r"\bdoubling\b",
    r"\bordre",
    r"\border",
    r"\bbacklog\b",
)
_NEGATIVE_STRONG = (
    r"\btap\b",
    r"\bunderskudd",
    r"\bkutt\b",
    r"\bkutter",
    r"\bvarsel",
    r"\bstreik",
    r"\bsøksmål",
    r"\bgransking",
    r"\betterforskning",
    r"\bnedgrader",
    r"\bkonkurs",
    r"\bnedskrivning",
    r"\bloss\b",
    r"\bwarning",
    r"\blawsuit",
    r"\binvestigation",
    r"\bdowngrade",
    r"\bimpairment",
    r"\blayoff",
    r"\bfraud",
    r"\bplunge",
)
_NEGATIVE_WEAK = (
    r"\bfall",
    r"\bnedgang",
    r"\bsvak",
    r"\bselger",
    r"\bsalg\b",
    r"\bavslutt",
    r"\bkanseller",
    r"\butsett",
    r"\bforsink",
    r"\bproblem",
    r"\bfeil\b",
    r"\bemisjon",
    r"\bdecline",
    r"\bweak",
    r"\bcut\b",
    r"\bdelay",
    r"\bterminates",
    r"\bmiss\b",
    r"\bdrop\b",
    r"\blowered",
    r"\bsenker",
)


def _keyword_score(title: str, patterns: tuple[str, ...], weight: int) -> int:
    return sum(
        weight for pattern in patterns if re.search(pattern, title, re.IGNORECASE)
    )


def classify_sentiment(title: str) -> str:
    """Grov klassifisering av en overskrift: positive, negative eller neutral."""
    text = " ".join(str(title or "").split())
    if not text:
        return "neutral"
    if re.search(r"\bprofit\s+warning\b", text, re.IGNORECASE):
        return "negative"
    positive = _keyword_score(text, _POSITIVE_STRONG, 2) + _keyword_score(
        text, _POSITIVE_WEAK, 1
    )
    negative = _keyword_score(text, _NEGATIVE_STRONG, 2) + _keyword_score(
        text, _NEGATIVE_WEAK, 1
    )
    if positive >= 2 and positive > negative:
        return "positive"
    if negative >= 2 and negative > positive:
        return "negative"
    return "neutral"


def aggregate_sentiment(items: Iterable[NewsItem]) -> str:
    """Samlet sentiment for en aksje, uten å dobbelttelle norsk/engelsk."""
    unique = unique_news(items)
    positive = sum(1 for item in unique if item.sentiment == "positive")
    negative = sum(1 for item in unique if item.sentiment == "negative")
    if positive and negative:
        return "mixed"
    if positive:
        return "positive"
    if negative:
        return "negative"
    return "neutral"


def _ticker_key(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value).upper())


def _name_key(value: str) -> str:
    text = str(value).casefold()
    text = re.sub(r"\b(asa|as|a/s|plc|ab|oy|oyj)\b", " ", text)
    return re.sub(r"[^a-z0-9æøå]+", "", text)


def _published_at(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(_OSLO)


def _category(message: dict[str, Any]) -> str:
    categories = message.get("category")
    if not isinstance(categories, list) or not categories:
        return ""
    first = categories[0]
    if not isinstance(first, dict):
        return ""
    return str(first.get("category_no") or first.get("category_en") or "").strip()


def _clean_title(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _norwegian_score(title: str) -> int:
    text = f" {title.casefold()} "
    score = sum(1 for hint in _NORWEGIAN_HINTS if hint in text)
    if any(char in text for char in "æøå"):
        score += 2
    return score


def unique_news(
    items: Iterable[NewsItem],
    limit: Optional[int] = None,
) -> list[NewsItem]:
    """Fjerner norsk/engelsk-duplikater og beholder nyeste per minutt.

    NewsWeb publiserer ofte samme sak på begge språk med nesten identisk
    tidspunkt. Vi viser én overskrift per minutt og foretrekker den norske.
    """
    best: dict[str, NewsItem] = {}
    for item in items:
        key = item.published_at.strftime("%Y-%m-%dT%H:%M")
        current = best.get(key)
        if current is None or _norwegian_score(item.title) > _norwegian_score(
            current.title
        ):
            best[key] = item
    ordered = sorted(best.values(), key=lambda item: item.published_at, reverse=True)
    return ordered[:limit] if limit is not None else ordered


def parse_news_payload(
    payload: dict[str, Any],
    since: datetime,
    fetched_at: datetime,
    source: str = "live",
    warning: Optional[str] = None,
) -> NewsFeed:
    """Gjør et NewsWeb-svar om til en NewsFeed. Ingen nettverkstilgang."""
    since_local = _as_oslo(since)
    data = payload.get("data")
    if not isinstance(data, dict):
        raise NewsSourceError("Svar fra NewsWeb mangler 'data'-objektet.")
    messages = data.get("messages")
    if not isinstance(messages, list):
        raise NewsSourceError("Svar fra NewsWeb mangler 'messages'-listen.")

    by_ticker: dict[str, list[NewsItem]] = {}
    by_name: dict[str, list[NewsItem]] = {}

    for message in messages:
        if not isinstance(message, dict):
            continue
        ticker = str(message.get("issuerSign") or "").strip().upper()
        if not ticker:
            continue
        published = _published_at(message.get("publishedTime"))
        if published is None or published < since_local:
            continue
        try:
            message_id = int(message.get("messageId"))
        except (TypeError, ValueError):
            continue
        title = _clean_title(message.get("title"))
        if not title:
            continue
        issuer_name = _clean_title(message.get("issuerName")) or ticker
        item = NewsItem(
            ticker=ticker,
            issuer_name=issuer_name,
            title=title,
            published_at=published,
            category=_category(message),
            message_id=message_id,
            url=NEWS_MESSAGE_URL.format(message_id=message_id),
            sentiment=classify_sentiment(title),
        )
        by_ticker.setdefault(_ticker_key(ticker), []).append(item)
        by_name.setdefault(_name_key(issuer_name), []).append(item)

    def _sort_groups(groups: dict[str, list[NewsItem]]) -> dict[str, tuple[NewsItem, ...]]:
        return {
            key: tuple(
                sorted(items, key=lambda item: item.published_at, reverse=True)
            )
            for key, items in groups.items()
        }

    if data.get("overflow") and not warning:
        warning = "NewsWeb svarte at listen kan være ufullstendig (overflow)."

    return NewsFeed(
        items_by_ticker=_sort_groups(by_ticker),
        items_by_name=_sort_groups(by_name),
        fetched_at=_as_utc(fetched_at),
        since=since_local,
        source=source,
        warning=warning,
        session_open=current_session_open(fetched_at),
    )


def _fetch_payload(
    since: datetime,
    until: datetime,
    timeout: float = 30.0,
) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {
            "fromDate": since.astimezone(_OSLO).date().isoformat(),
            "toDate": until.astimezone(_OSLO).date().isoformat(),
        }
    )
    request = urllib.request.Request(
        f"{NEWS_API_URL}?{query}",
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
        raise NewsSourceError("NewsWeb returnerte et tomt svar.")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise NewsSourceError(f"Ugyldig JSON fra NewsWeb: {exc}") from exc
    if not isinstance(payload, dict):
        raise NewsSourceError("Uventet svarformat fra NewsWeb.")
    return payload


def _fetch_with_retry(
    since: datetime,
    until: datetime,
    timeout: float,
    retries: int,
) -> dict[str, Any]:
    last_error: Optional[Exception] = None
    for attempt in range(1, max(1, retries) + 1):
        try:
            return _fetch_payload(since=since, until=until, timeout=timeout)
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            OSError,
            NewsSourceError,
        ) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(min(2 ** (attempt - 1), 4))
    raise NewsSourceError(f"Kunne ikke hente børsmeldinger: {last_error}") from last_error


def _read_cache(
    path: Path,
) -> Optional[tuple[float, datetime, dict[str, Any]]]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            cached = json.load(handle)
        fetched_at = float(cached["fetched_at"])
        since = datetime.fromisoformat(str(cached["since"]))
        payload = cached["payload"]
        if not isinstance(payload, dict):
            return None
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("messages"), list):
            return None
        return fetched_at, _as_oslo(since), payload
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _write_cache(
    path: Path,
    since: datetime,
    payload: dict[str, Any],
) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(
                {
                    "fetched_at": time.time(),
                    "since": since.isoformat(),
                    "payload": payload,
                },
                handle,
                ensure_ascii=False,
            )
        tmp.replace(path)
    except OSError:
        # Cache er en optimalisering, ikke et krav.
        pass


def fetch_news(
    cache_ttl: float = DEFAULT_NEWS_TTL,
    force: bool = False,
    timeout: float = 30.0,
    retries: int = 2,
    cache_path: Optional[Path] = None,
    now: Optional[datetime] = None,
) -> NewsFeed:
    """Henter børsmeldinger siden forrige handelsdag stengte.

    Returnerer alltid en NewsFeed. Ved nettverksfeil brukes cache hvis den
    finnes; ellers kommer en tom feed med en advarsel.
    """
    current = _as_utc(now or datetime.now(timezone.utc))
    since = news_window_start(current)
    path = cache_path or DEFAULT_NEWS_CACHE_PATH
    cached = _read_cache(path)

    if cached and not force and cached[1] == since:
        age = time.time() - cached[0]
        if age <= cache_ttl:
            return parse_news_payload(
                cached[2],
                since=cached[1],
                fetched_at=datetime.fromtimestamp(cached[0], tz=timezone.utc),
                source="cache",
            )

    try:
        payload = _fetch_with_retry(
            since=since,
            until=current,
            timeout=timeout,
            retries=retries,
        )
    except NewsSourceError as exc:
        if cached:
            return parse_news_payload(
                cached[2],
                since=cached[1],
                fetched_at=datetime.fromtimestamp(cached[0], tz=timezone.utc),
                source="stale-cache",
                warning=(
                    f"Ferske børsmeldinger kunne ikke hentes ({exc}). "
                    f"Viser cache fra {_as_oslo(datetime.fromtimestamp(cached[0], tz=timezone.utc)):%d.%m.%Y %H:%M}."
                ),
            )
        return NewsFeed(
            items_by_ticker={},
            items_by_name={},
            fetched_at=current,
            since=since,
            source="error",
            warning=f"Kunne ikke hente børsmeldinger: {exc}",
            session_open=current_session_open(current),
        )

    try:
        feed = parse_news_payload(
            payload,
            since=since,
            fetched_at=current,
            source="live",
        )
    except NewsSourceError as exc:
        if cached:
            return parse_news_payload(
                cached[2],
                since=cached[1],
                fetched_at=datetime.fromtimestamp(cached[0], tz=timezone.utc),
                source="stale-cache",
                warning=(
                    f"NewsWeb svarte ugyldig ({exc}). Viser cache fra "
                    f"{_as_oslo(datetime.fromtimestamp(cached[0], tz=timezone.utc)):%d.%m.%Y %H:%M}."
                ),
            )
        return NewsFeed(
            items_by_ticker={},
            items_by_name={},
            fetched_at=current,
            since=since,
            source="error",
            warning=f"NewsWeb svarte ugyldig: {exc}",
            session_open=current_session_open(current),
        )

    _write_cache(path, since, payload)
    return feed
