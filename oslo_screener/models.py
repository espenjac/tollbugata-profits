"""Datamodeller for Oslo Børs-screeneren."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

# Hvis TradingViews "High.All" er mer enn dette ganger 52-ukershøyeste,
# antar vi at den er forurenset av en splitt/omvendt splitt og ikke kan
# brukes til å avgjøre om aksjen er på all-time high.
ATH_DISTORTION_RATIO = 50.0


@dataclass(frozen=True)
class Stock:
    """En notert aksje med feltene screenen trenger."""

    ticker: str
    name: str
    close: float
    currency: str
    week_return: Optional[float]  # 1 ukes avkastning som brøk (0.05 = 5 %)
    month_return: Optional[float]
    quarter_return: Optional[float]
    sma5: Optional[float]
    sma20: Optional[float]
    sma50: Optional[float]
    rsi: Optional[float]
    ath: Optional[float]
    high_52w: Optional[float]
    market_cap: Optional[float]
    volume: Optional[float]
    sector: str
    instrument_type: str = "stock"
    market: str = "oslo"  # "oslo" eller "euronext_growth"
    earnings_date: Optional[date] = None
    ex_dividend_date: Optional[date] = None
    average_volume_10d: Optional[float] = None
    atr: Optional[float] = None
    day_return: Optional[float] = None  # siste handelsdags avkastning som brøk

    @property
    def is_growth(self) -> bool:
        """Om aksjen er notert på Euronext Growth."""
        return self.market == "euronext_growth"

    @property
    def reference_ath(self) -> Optional[float]:
        """Beste tilgjengelige anslag på all-time high.

        All-time high kan aldri være lavere enn 52-ukershøyeste. Tar derfor
        maksimum av de to dersom begge finnes.
        """
        candidates = [v for v in (self.ath, self.high_52w) if v is not None and v > 0]
        return max(candidates) if candidates else None

    @property
    def ath_is_reliable(self) -> bool:
        """Om all-time high-tallet er troverdig nok til å brukes direkte."""
        if self.ath is None or self.ath <= 0:
            return False
        if self.high_52w and self.high_52w > 0:
            if self.ath > self.high_52w * ATH_DISTORTION_RATIO:
                return False
        return True

    @property
    def distance_to_ath(self) -> Optional[float]:
        """Hvor langt under all-time high kursen er, som brøk.

        -0.12 betyr 12 % under ATH. Returnerer None når ATH ikke er
        troverdig, slik at vi ikke viser et misvisende tall.
        """
        if not self.ath_is_reliable:
            return None
        ref = self.reference_ath
        if ref is None:
            return None
        return self.close / ref - 1.0

    @property
    def turnover(self) -> Optional[float]:
        """Omsatt verdi i dag (kurs × volum), i noteringsvalutaen."""
        if self.volume is None:
            return None
        return self.close * self.volume

    @property
    def average_turnover(self) -> Optional[float]:
        """Gjennomsnittlig omsatt verdi per dag (kurs × 10-dagers snittvolum)."""
        if self.average_volume_10d is None:
            return None
        return self.close * self.average_volume_10d

    @property
    def atr_pct(self) -> Optional[float]:
        """Daglig volatilitet (ATR) som andel av kursen."""
        if self.atr is None or self.close <= 0:
            return None
        return self.atr / self.close
