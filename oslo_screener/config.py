"""Konfigurasjon for pre-market-scoring, handel og rapport.

Alle vekter og terskler er samlet her. De kan overstyres med en JSON-fil
(``--config``) eller enkelte kommandolinjeflagg. Standardverdiene er startpunkter
for videre testing – ikke optimaliserte eller garantert lønnsomme.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any, TypeVar

T = TypeVar("T")


@dataclass(frozen=True)
class ScoringWeights:
    """Vekter for mulighetsscoren. Summen normaliseres av modellen."""

    momentum: float = 0.16
    trend: float = 0.14
    relative_strength: float = 0.09
    liquidity: float = 0.15
    volume: float = 0.09
    technical_upside: float = 0.08
    volatility: float = 0.05
    news: float = 0.11
    breakout: float = 0.05
    consistency: float = 0.08

    @property
    def total(self) -> float:
        return sum(
            getattr(self, item.name)
            for item in fields(self)
            if item.name != "total"
        )


@dataclass(frozen=True)
class RiskWeights:
    """Vekter for risikoscoren. Høyere risikoscore er dårligere."""

    volatility: float = 0.18
    overextension: float = 0.18
    spike: float = 0.12
    liquidity: float = 0.14
    event: float = 0.14
    negative_news: float = 0.14
    market_cap: float = 0.05
    price: float = 0.05

    @property
    def total(self) -> float:
        return sum(
            getattr(self, item.name)
            for item in fields(self)
            if item.name != "total"
        )


@dataclass(frozen=True)
class ScoringConfig:
    """Krav og vekter for å rangere en mulig daytrade."""

    min_price: float = 5.0
    min_market_cap: float = 300_000_000.0
    min_average_turnover: float = 5_000_000.0
    max_week_return: float = 0.25
    max_rsi: float = 82.0
    target_atr_pct: float = 0.025
    breakout_distance: float = 0.05
    overextended_week: float = 0.15
    overextended_rsi: float = 75.0
    smooth_day_return: float = 0.02
    smooth_day_share: float = 0.40
    spike_day_return: float = 0.04
    spike_day_share: float = 0.60
    strong_spike_day_return: float = 0.07
    spike_sma5_distance: float = 0.05
    risk_penalty: float = 0.45
    weights: ScoringWeights = field(default_factory=ScoringWeights)
    risk_weights: RiskWeights = field(default_factory=RiskWeights)


@dataclass(frozen=True)
class TradeConfig:
    """Kapital, kurtasje og risiko for én manuell handel."""

    capital: float = 5_000.0
    buy_fee: float = 29.0
    sell_fee: float = 29.0
    target_pct: float = 0.02
    stop_loss_pct: float = 0.02
    slippage_pct: float = 0.0  # antatt slippage ved kjøp og salg, 0 som standard
    # Med 5 000 kr og 29 kr kurtasje er 1:1 etter kurtasje nesten umulig ved 2 %
    # mål. Forholdet vises i rapporten, men blokkerer ikke som standard.
    min_reward_risk: float = 0.0
    scenario_pcts: tuple[float, ...] = (-0.02, -0.01, 0.01, 0.02, 0.03, 0.04, 0.05)


@dataclass(frozen=True)
class ReportConfig:
    """Krav for at en kandidat skal kunne bli dagens hovedanbefaling."""

    # Gjelder både anbefalte alternativer og den separate listen over
    # blokkerte kandidater.
    max_alternatives: int = 10
    min_total_score: float = 58.0
    min_opportunity: float = 55.0
    max_risk: float = 58.0
    min_turnover: float = 10_000_000.0
    block_negative_news: bool = True
    block_earnings_within_days: int = 1
    block_ex_date_within_days: int = 0


@dataclass(frozen=True)
class Settings:
    """Samlet konfigurasjon for screener, rapport og backtest."""

    scoring: ScoringConfig = field(default_factory=ScoringConfig)
    trade: TradeConfig = field(default_factory=TradeConfig)
    report: ReportConfig = field(default_factory=ReportConfig)

    def to_dict(self) -> dict[str, Any]:
        return {
            "scoring": _asdict(self.scoring),
            "trade": _asdict(self.trade),
            "report": _asdict(self.report),
        }


def _asdict(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return {item.name: _asdict(getattr(value, item.name)) for item in fields(value)}
    if isinstance(value, tuple):
        return [_asdict(item) for item in value]
    return value


def _from_dict(cls: type[T], data: Any) -> T:
    """Bygg en dataclass fra et delvis JSON-objekt med tydelige feil."""
    if data is None:
        return cls()
    if not isinstance(data, dict):
        raise ValueError(f"Forventet et JSON-objekt for {cls.__name__}.")
    allowed = {item.name: item for item in fields(cls)}
    unknown = set(data) - set(allowed)
    if unknown:
        raise ValueError(
            f"Ukjente innstillinger for {cls.__name__}: {', '.join(sorted(unknown))}"
        )
    kwargs: dict[str, Any] = {}
    for name, value in data.items():
        field_type = allowed[name]
        if name == "weights":
            kwargs[name] = _from_dict(ScoringWeights, value)
        elif name == "risk_weights":
            kwargs[name] = _from_dict(RiskWeights, value)
        elif name == "scoring":
            kwargs[name] = _from_dict(ScoringConfig, value)
        elif name == "trade":
            kwargs[name] = _from_dict(TradeConfig, value)
        elif name == "report":
            kwargs[name] = _from_dict(ReportConfig, value)
        elif name in {"capital", "buy_fee", "sell_fee", "target_pct", "stop_loss_pct",
                      "slippage_pct", "min_reward_risk", "min_price",
                      "min_market_cap", "min_average_turnover", "max_week_return",
                      "max_rsi", "target_atr_pct", "breakout_distance",
                      "overextended_week", "overextended_rsi",
                      "smooth_day_return", "smooth_day_share",
                      "spike_day_return", "spike_day_share",
                      "strong_spike_day_return", "spike_sma5_distance",
                      "risk_penalty", "min_total_score", "min_opportunity",
                      "max_risk", "min_turnover"}:
            try:
                kwargs[name] = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{cls.__name__}.{name} må være et tall.") from exc
        elif name in {"max_alternatives", "block_earnings_within_days",
                      "block_ex_date_within_days"}:
            try:
                kwargs[name] = int(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{cls.__name__}.{name} må være et heltall.") from exc
        elif name == "block_negative_news":
            kwargs[name] = bool(value)
        elif name == "scenario_pcts":
            try:
                kwargs[name] = tuple(float(item) for item in value)
            except (TypeError, ValueError) as exc:
                raise ValueError("scenario_pcts må være en liste med tall.") from exc
        else:
            kwargs[name] = value
    return cls(**kwargs)


def load_settings(path: str | Path | None = None) -> Settings:
    """Les innstillinger fra JSON. Uten sti brukes standardverdiene."""
    if path is None:
        settings = Settings()
    else:
        file_path = Path(path)
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise ValueError(f"Kunne ikke lese konfigurasjonen {file_path}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise ValueError(f"Ugyldig JSON i {file_path}: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError("Konfigurasjonsfilen må inneholde et JSON-objekt.")
        settings = _from_dict(Settings, data)
    _validate(settings)
    return settings


def validate_settings(settings: Settings) -> None:
    """Valider en samlet konfigurasjon, også etter CLI-overstyringer."""
    _validate(settings)


def _validate(settings: Settings) -> None:
    if settings.scoring.weights.total <= 0:
        raise ValueError("Summen av mulighetsvektene må være større enn 0.")
    if settings.scoring.risk_weights.total <= 0:
        raise ValueError("Summen av risikovektene må være større enn 0.")
    for name, value in _asdict(settings.scoring.weights).items():
        if not isinstance(value, (int, float)) or value < 0:
            raise ValueError(f"Ugyldig mulighetsvekt: {name}.")
    for name, value in _asdict(settings.scoring.risk_weights).items():
        if not isinstance(value, (int, float)) or value < 0:
            raise ValueError(f"Ugyldig risikovekt: {name}.")
    if settings.trade.capital < 100:
        raise ValueError("Startkapitalen må være minst 100 kroner.")
    if settings.trade.buy_fee < 0 or settings.trade.sell_fee < 0:
        raise ValueError("Kurtasje kan ikke være negativ.")
    if settings.trade.target_pct <= 0 or settings.trade.stop_loss_pct <= 0:
        raise ValueError("Gevinstmål og tapsgrense må være positive.")
    if settings.trade.slippage_pct < 0:
        raise ValueError("Slippage kan ikke være negativ.")
    if not settings.trade.scenario_pcts:
        raise ValueError("scenario_pcts må inneholde minst ett scenario.")
    if not 0.0 <= settings.scoring.risk_penalty <= 1.0:
        raise ValueError("risk_penalty må være mellom 0 og 1.")
    if not (
        0.0 <= settings.scoring.smooth_day_return
        <= settings.scoring.spike_day_return
        <= settings.scoring.strong_spike_day_return
    ):
        raise ValueError(
            "Krever 0 ≤ smooth_day_return ≤ spike_day_return "
            "≤ strong_spike_day_return."
        )
    for name in ("smooth_day_share", "spike_day_share"):
        value = getattr(settings.scoring, name)
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"{name} må være mellom 0 og 1.")
    if settings.scoring.spike_sma5_distance < 0:
        raise ValueError("spike_sma5_distance kan ikke være negativ.")
    if settings.report.max_alternatives < 0:
        raise ValueError("max_alternatives kan ikke være negativ.")
