"""Pre-market-rapport for én manuell daytrade.

Rapporten bygges før børsåpning og bruker bare data som var kjent på det
tidspunktet: siste avsluttede daglige data og børsmeldinger fram til
genereringstidspunktet. Den anbefaler aldri å handle automatisk.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

from .config import Settings
from .data import Universe
from .formatting import days_until, format_money, format_pct
from .logic import Criteria
from .news import NewsFeed
from .signals import EVENT_LABELS
from .strategy import Candidate, rank_candidates
from .trade import TradePlan, build_trade_plan

try:
    _OSLO = ZoneInfo("Europe/Oslo")
except Exception:  # pragma: no cover - mangler tidssonedata
    _OSLO = timezone.utc

DEFAULT_REPORTS_ROOT = Path(
    os.environ.get(
        "TP_REPORTS_ROOT",
        str(Path(__file__).resolve().parent.parent / "reports"),
    )
).expanduser()
DEFAULT_REPORT_DIR = DEFAULT_REPORTS_ROOT / "premarket"
DEFAULT_BACKTEST_PATH = DEFAULT_REPORTS_ROOT / "backtest_latest.json"


@dataclass(frozen=True)
class PlannedCandidate:
    """En rangert kandidat med en konkret, manuell handelsplan."""

    candidate: Candidate
    trade: TradePlan
    recommendable: bool
    block_reasons: tuple[str, ...] = ()

    @property
    def category_labels(self) -> tuple[str, ...]:
        labels = {
            "momentum": "Momentum",
            "breakout": "Breakout",
            "news": "Nyhetsdrevet",
        }
        return tuple(labels.get(value, value) for value in self.candidate.categories)

    @property
    def news_reason(self) -> str:
        signal = self.candidate.news_signal
        if signal.count == 0:
            return "Ingen relevante børsmeldinger i nyhetsvinduet."
        label = EVENT_LABELS.get(signal.event_type, signal.event_type)
        return f"{label}: {signal.latest_title}"


@dataclass(frozen=True)
class PremarketReport:
    """Dagens rapport med hovedkandidat og alternativer."""

    generated_at: datetime
    universe_fetched_at: datetime
    universe_source: str
    criteria: Criteria
    settings: Settings
    ranked: tuple[PlannedCandidate, ...]
    main: Optional[PlannedCandidate]
    alternatives: tuple[PlannedCandidate, ...]
    blocked: tuple[PlannedCandidate, ...]
    no_trade_reason: Optional[str]
    news_since: Optional[datetime]
    news_source: Optional[str]
    data_basis: str
    is_premarket: bool
    warnings: tuple[str, ...] = ()

    @property
    def has_recommendation(self) -> bool:
        return self.main is not None


def _is_premarket(now: datetime) -> bool:
    local = now.astimezone(_OSLO)
    if local.weekday() >= 5:
        return True
    return local.time() < time(9, 0)


def _block_reasons(
    candidate: Candidate,
    trade: TradePlan,
    settings: Settings,
    today: date,
) -> tuple[str, ...]:
    reasons: list[str] = []
    report = settings.report
    if candidate.score < report.min_total_score:
        reasons.append(f"samlet score {candidate.score:.0f} < {report.min_total_score:.0f}")
    if candidate.opportunity_score < report.min_opportunity:
        reasons.append(
            f"mulighetsscore {candidate.opportunity_score:.0f} < "
            f"{report.min_opportunity:.0f}"
        )
    if candidate.risk_score > report.max_risk:
        reasons.append(
            f"risikoscore {candidate.risk_score:.0f} > {report.max_risk:.0f}"
        )
    if not trade.feasible:
        reasons.append("ikke nok kapital til én hel aksje etter kurtasje")
    elif trade.target_net <= 0:
        reasons.append("gevinstmålet dekker ikke kurtasjen etter kurtasje")
    if trade.reward_risk is not None and trade.reward_risk < settings.trade.min_reward_risk:
        reasons.append("gevinst/tap-forholdet er for lavt")
    turnover = candidate.stock.average_turnover
    if turnover is None or turnover < report.min_turnover:
        reasons.append("likviditeten er under rapportens minstekrav")
    if not candidate.categories:
        reasons.append("ingen tydelig kategori (momentum, breakout eller nyheter)")
    if report.block_negative_news and candidate.news_signal.is_negative:
        reasons.append("negativt nyhetssignal")
    earnings = days_until(candidate.stock.earnings_date, today)
    if (
        earnings is not None
        and 0 <= earnings <= report.block_earnings_within_days
    ):
        if report.block_earnings_within_days <= 1:
            reasons.append("resultat i dag eller i morgen")
        else:
            reasons.append(
                f"resultat innen {report.block_earnings_within_days} dager"
            )
    ex_date = days_until(candidate.stock.ex_dividend_date, today)
    if (
        ex_date is not None
        and 0 <= ex_date <= report.block_ex_date_within_days
    ):
        if report.block_ex_date_within_days == 0:
            reasons.append("ex-dato i dag")
        else:
            reasons.append(f"ex-dato innen {report.block_ex_date_within_days} dager")
    return tuple(reasons)


def build_premarket_report(
    stocks: Iterable[object],
    criteria: Criteria,
    universe: Universe,
    news: Optional[NewsFeed] = None,
    settings: Optional[Settings] = None,
    today: Optional[date] = None,
    now: Optional[datetime] = None,
) -> PremarketReport:
    """Bygg rapporten uten å hente nye data og uten å bruke framtidige data."""
    cfg = settings or Settings()
    current = now or datetime.now(timezone.utc)
    local_date = today or current.astimezone(_OSLO).date()
    stock_list = list(stocks)
    ranked = rank_candidates(
        stock_list,
        limit=len(stock_list),
        today=local_date,
        news=news,
        config=cfg.scoring,
    )
    planned: list[PlannedCandidate] = []
    for candidate in ranked:
        trade = build_trade_plan(candidate.stock.close, cfg.trade)
        reasons = _block_reasons(candidate, trade, cfg, local_date)
        planned.append(
            PlannedCandidate(
                candidate=candidate,
                trade=trade,
                recommendable=not reasons,
                block_reasons=reasons,
            )
        )

    recommendable = [item for item in planned if item.recommendable]
    blocked = [item for item in planned if not item.recommendable]
    main = recommendable[0] if recommendable else None
    # Blokkerte kandidater skal aldri fremstå som et anbefalt alternativ. De
    # vises i en egen seksjon, også når de har høyere totalscore enn
    # hovedkandidaten.
    alternatives = tuple(
        item for item in recommendable if item is not main
    )[: cfg.report.max_alternatives]
    blocked = tuple(blocked[: cfg.report.max_alternatives])
    selected = ((main,) if main is not None else ()) + alternatives + blocked

    no_trade_reason: Optional[str] = None
    if main is None:
        if not planned:
            no_trade_reason = (
                "Ingen anbefalte kandidater i dag – vurder å stå over. "
                "Ingen aksjer passerte de tekniske kandidatfiltrene."
            )
        else:
            best = planned[0]
            reason = (
                "; ".join(best.block_reasons)
                if best.block_reasons
                else "kravene er ikke oppfylt"
            )
            no_trade_reason = (
                "Ingen anbefalte kandidater i dag – vurder å stå over. "
                f"Beste kandidat er {best.candidate.stock.ticker}, men {reason}."
            )

    warnings: list[str] = []
    if universe.warning:
        warnings.append(universe.warning)
    if universe.growth_warning:
        warnings.append(universe.growth_warning)
    if news is not None and news.warning:
        warnings.append(news.warning)
    if (
        main is not None
        and main.trade.reward_risk is not None
        and main.trade.reward_risk < 1.0
    ):
        warnings.append(
            f"Gevinst/tap-forholdet er under 1:1 etter kurtasje. Med "
            f"{format_money(main.trade.capital)} kapital og "
            f"{format_money(main.trade.buy_fee + main.trade.sell_fee)} i kurtasje "
            "spiser kostnadene en stor del av et "
            f"{format_pct(cfg.trade.target_pct, signed=False)} mål; vurder et "
            "høyere mål eller la handelen være."
        )
    if not _is_premarket(current):
        warnings.append(
            "Rapporten ble laget etter børsåpning. Daglige data kan da inneholde "
            "dagens delvise volum; bruk den som et estimat, ikke som ren pre-market-data."
        )

    source = universe.source
    data_basis = (
        "Siste avsluttede daglige TradingView-data"
        f" ({universe.fetched_at.astimezone(_OSLO):%d.%m.%Y %H:%M})"
        + (
            f" og NewsWeb til {news.fetched_at.astimezone(_OSLO):%d.%m.%Y %H:%M}"
            if news is not None
            else " uten nyhetshenting"
        )
        + ". Ingen intradagdata, VWAP eller åpningsrange inngår i scoren."
    )
    return PremarketReport(
        generated_at=current,
        universe_fetched_at=universe.fetched_at,
        universe_source=source,
        criteria=criteria,
        settings=cfg,
        ranked=tuple(selected),
        main=main,
        alternatives=alternatives,
        blocked=blocked,
        no_trade_reason=no_trade_reason,
        news_since=news.since if news is not None else None,
        news_source=news.source if news is not None else None,
        data_basis=data_basis,
        is_premarket=_is_premarket(current),
        warnings=tuple(warnings),
    )


def _report_filename(report: PremarketReport) -> str:
    return report.generated_at.astimezone(timezone.utc).strftime(
        "%Y%m%dT%H%M%S_%fZ"
    ) + ".json"


def save_report(
    report: PremarketReport,
    directory: Path | str = DEFAULT_REPORT_DIR,
    news: Optional[NewsFeed] = None,
) -> Path:
    """Lagre en rapport uten å overskrive tidligere rapporter."""
    from .serialize import premarket_to_dict

    target_dir = Path(directory)
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / _report_filename(report)
    counter = 1
    while path.exists():
        path = target_dir / f"{_report_filename(report)[:-5]}_{counter}.json"
        counter += 1
    payload = premarket_to_dict(report, news=news)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp.replace(path)
    return path


def list_saved_reports(
    directory: Path | str = DEFAULT_REPORT_DIR,
) -> list[Path]:
    target_dir = Path(directory)
    if not target_dir.exists():
        return []
    return sorted(target_dir.glob("*.json"))


def save_daily_report(
    report: PremarketReport,
    directory: Path | str = DEFAULT_REPORT_DIR,
    news: Optional[NewsFeed] = None,
) -> Optional[Path]:
    """Lagre høyst én rapport per lokal dag fra webappen.

    Kommandolinjen kan lagre hver kjøring, men en sideoppdatering i webappen
    skal ikke fylle rapportmappen med nesten identiske filer.
    """
    latest = load_latest_report(directory)
    if latest is not None:
        generated = latest.get("generated_at")
        if isinstance(generated, str):
            try:
                latest_at = datetime.fromisoformat(generated)
            except ValueError:
                latest_at = None
            if (
                latest_at is not None
                and latest_at.astimezone(_OSLO).date()
                == report.generated_at.astimezone(_OSLO).date()
            ):
                return None
    return save_report(report, directory, news=news)


def load_report_history(
    directory: Path | str = DEFAULT_REPORT_DIR,
    limit: int = 5,
) -> list[dict]:
    """Les en kompakt historikk fra de nyeste lagrede rapportene."""
    if limit <= 0:
        return []
    reports = list_saved_reports(directory)
    history: list[dict] = []
    for path in reversed(reports[-limit:]):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        main = payload.get("main")
        if not isinstance(main, dict):
            main = {}
        history.append(
            {
                "file": path.name,
                "generated_at": payload.get("generated_at"),
                "recommended": bool(payload.get("has_recommendation")),
                "ticker": main.get("ticker"),
                "name": main.get("name"),
                "score": main.get("score"),
                "risk_score": main.get("risk_score"),
                "categories": main.get("category_labels", []),
                "reason": payload.get("no_trade_reason"),
            }
        )
    return history


def load_latest_report(
    directory: Path | str = DEFAULT_REPORT_DIR,
) -> Optional[dict]:
    reports = list_saved_reports(directory)
    if not reports:
        return None
    try:
        payload = json.loads(reports[-1].read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def load_latest_backtest(
    path: Path | str = DEFAULT_BACKTEST_PATH,
) -> Optional[dict]:
    file_path = Path(path)
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None
