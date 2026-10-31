"""Små, datakilde-uavhengige signaler brukt av scoremodellen."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class NewsSignal:
    """Samlet nyhetssignal for én aksje.

    Signalet er en grov klassifisering, ikke en vurdering av nyheten. Det brukes
    bare som ett av flere innspill til en relativ poengsum.
    """

    sentiment: str = "neutral"  # positive, negative, neutral eller mixed
    relevance: str = "low"  # high, medium eller low
    event_type: str = "other"
    count: int = 0
    latest_title: str = ""

    @property
    def is_relevant(self) -> bool:
        return self.count > 0 and self.relevance in ("high", "medium")

    @property
    def is_negative(self) -> bool:
        return self.sentiment in ("negative", "mixed")

    def to_dict(self) -> dict[str, Any]:
        return {
            "sentiment": self.sentiment,
            "relevance": self.relevance,
            "event_type": self.event_type,
            "count": self.count,
            "latest_title": self.latest_title,
        }


EVENT_LABELS = {
    "result": "Resultat",
    "contract": "Kontrakt/ordre",
    "capital_raise": "Kapitalinnhenting/emisjon",
    "insider": "Innsiderhandel",
    "acquisition": "Oppkjøp/strategi",
    "dividend": "Utbytte",
    "other": "Annet",
}

RELEVANCE_LABELS = {
    "high": "Høy",
    "medium": "Middels",
    "low": "Lav",
}
