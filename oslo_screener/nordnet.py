"""Nordnet-lenker for aksjene i screenen.

Nordnet bruker URL-er på formen
``https://www.nordnet.no/aksjer/kurser/<navn>-<ticker>-<mic>``.
Kartet i ``nordnet_slugs.json`` er generert fra Nordnets sitemap og dekker
Oslo Børs-tickerne. For nye tickere lages en beste-innsats-slug.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Optional

from .models import Stock

NORDNET_BASE = "https://www.nordnet.no/aksjer/kurser/"
_SLUG_FILE = Path(__file__).with_name("nordnet_slugs.json")

_LEGAL_SUFFIXES = re.compile(
    r"\b(asa|as|plc|ltd|limited|ab|n\.?v\.?|inc|corp|corporation)\b\.?",
    re.IGNORECASE,
)


@lru_cache(maxsize=1)
def _slugs() -> dict[str, str]:
    try:
        with _SLUG_FILE.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(key).upper(): str(value) for key, value in data.items()}


def _guess_slug(stock: Stock) -> str:
    name = _LEGAL_SUFFIXES.sub(" ", stock.name)
    # Nordnet splitter CamelCase, f.eks. HydrogenPro -> hydrogen-pro.
    name = re.sub(r"(?<=[a-zæøå])(?=[A-ZÆØÅ])", " ", name)
    name = unicodedata.normalize("NFKD", name)
    name = name.encode("ascii", "ignore").decode("ascii")
    name = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    if not name:
        return f"{stock.ticker.lower()}-xosl"
    return f"{name}-{stock.ticker.lower()}-xosl"


def nordnet_url(stock: Stock) -> str:
    """Returnerer lenken til aksjens side (med graf) hos Nordnet."""
    slug = _slugs().get(stock.ticker.upper())
    if slug is None:
        slug = _guess_slug(stock)
    return NORDNET_BASE + slug


def nordnet_url_for_ticker(ticker: str) -> Optional[str]:
    """Slår opp en ticker uten å kjenne selskapsnavnet."""
    slug = _slugs().get(ticker.upper())
    return NORDNET_BASE + slug if slug else None
