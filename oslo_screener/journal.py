"""Lokal handelsdagbok og kontobeholdning.

Dagboken er laget for manuell registrering etter at en handel faktisk er utført.
Den sender ingen ordrer, kobler seg ikke til en megler og er ikke fasit for
bankens saldo. Alle tall er det brukeren selv har lagt inn.

Filen lagres lokalt som JSON. Skriving skjer atomisk via en midlertidig fil, slik
at en avbrutt skriving ikke ødelegger hele dagboken.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .config import Settings

DEFAULT_JOURNAL_PATH = Path(__file__).resolve().parent.parent / "data" / "journal.json"
_TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9._-]{0,19}$")


class JournalError(ValueError):
    """Ugyldig handelslogg, saldo eller lagringsfil."""


@dataclass(frozen=True)
class TradeEntry:
    """Én registrert, allerede utført kjøps- eller salgshandel."""

    id: int
    executed_at: datetime
    registered_at: datetime
    ticker: str
    side: str
    quantity: int
    price: float
    fee: float
    note: str
    cash_change: float
    edited_at: Optional[datetime] = None

    @property
    def gross(self) -> float:
        return _money(self.quantity * self.price)

    @property
    def net_cash(self) -> float:
        return self.cash_change

    @property
    def side_label(self) -> str:
        return "Kjøp" if self.side == "buy" else "Salg"


@dataclass(frozen=True)
class CashAdjustment:
    """Manuell oppdatering av ledig kapital."""

    id: int
    changed_at: datetime
    previous_cash: float
    new_cash: float
    note: str

    @property
    def difference(self) -> float:
        return _money(self.new_cash - self.previous_cash)


@dataclass(frozen=True)
class Journal:
    """Hele den lokale dagboken."""

    available_cash: float
    trades: tuple[TradeEntry, ...]
    adjustments: tuple[CashAdjustment, ...]
    updated_at: datetime
    next_id: int = 1
    version: int = 1


@dataclass(frozen=True)
class Holding:
    """Netto logget beholdning per ticker, uten markedsverdi."""

    ticker: str
    quantity: int
    cost_basis: float

    @property
    def average_cost(self) -> Optional[float]:
        if self.quantity <= 0:
            return None
        return self.cost_basis / self.quantity


@dataclass(frozen=True)
class JournalSummary:
    """Beregnet sammendrag fra dagboken."""

    available_cash: float
    holdings: tuple[Holding, ...]
    realized_profit: float
    total_fees: float
    total_turnover: float
    buy_count: int
    sell_count: int


def _money(value: float) -> float:
    return round(float(value) + 1e-9, 2)


def _local_now() -> datetime:
    return datetime.now().astimezone()


def _as_local_datetime(value: datetime | str | None, name: str) -> datetime:
    if value is None:
        return _local_now()
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError as exc:
            raise JournalError(f"{name} har ugyldig dato/tid.") from exc
    if not isinstance(value, datetime):
        raise JournalError(f"{name} må være en dato og tid.")
    if value.tzinfo is None:
        value = value.replace(tzinfo=_local_now().tzinfo)
    return value


def _normalize_ticker(value: str) -> str:
    ticker = str(value or "").strip().upper()
    if not ticker:
        raise JournalError("Ticker mangler.")
    if not _TICKER_RE.match(ticker):
        raise JournalError(
            "Ticker kan bare inneholde bokstaver, tall, punktum, bindestrek og _."
        )
    return ticker


def _number(value: Any, name: str, minimum: float = 0.0) -> float:
    if isinstance(value, bool):
        raise JournalError(f"{name} må være et tall.")
    try:
        number = float(str(value).replace(",", "."))
    except (TypeError, ValueError) as exc:
        raise JournalError(f"{name} må være et tall.") from exc
    if number != number or number in (float("inf"), float("-inf")):
        raise JournalError(f"{name} må være et endelig tall.")
    if number < minimum:
        raise JournalError(f"{name} kan ikke være lavere enn {minimum:g}.")
    return number


def _whole_shares(value: Any) -> int:
    if isinstance(value, bool):
        raise JournalError("Antall aksjer må være et heltall.")
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise JournalError("Antall aksjer må være et heltall.") from exc
    if number <= 0:
        raise JournalError("Antall aksjer må være større enn 0.")
    return number


def _clean_note(value: Any, max_length: int = 500) -> str:
    note = str(value or "").strip()
    if len(note) > max_length:
        raise JournalError(f"Notatet kan ikke være lengre enn {max_length} tegn.")
    return note


def _parse_trade(data: Any, index: int) -> TradeEntry:
    if not isinstance(data, dict):
        raise JournalError(f"Handel nummer {index} er ikke et JSON-objekt.")
    try:
        trade_id = int(data.get("id", index))
        executed_at = _as_local_datetime(data.get("executed_at"), "executed_at")
        registered_at = _as_local_datetime(
            data.get("registered_at") or data.get("executed_at"),
            "registered_at",
        )
        ticker = _normalize_ticker(str(data.get("ticker", "")))
        side = str(data.get("side", "")).strip().lower()
        if side not in {"buy", "sell"}:
            raise JournalError("Handelens side må være buy eller sell.")
        quantity = _whole_shares(data.get("quantity"))
        price = _number(data.get("price"), "Kurs")
        fee = _number(data.get("fee", 0.0), "Kurtasje")
        note = _clean_note(data.get("note", ""))
        edited_at = (
            _as_local_datetime(data.get("edited_at"), "edited_at")
            if data.get("edited_at")
            else None
        )
    except JournalError as exc:
        raise JournalError(f"Handel nummer {index}: {exc}") from exc
    cash_change = _money(
        -(quantity * price) - fee if side == "buy" else (quantity * price) - fee
    )
    return TradeEntry(
        id=trade_id,
        executed_at=executed_at,
        registered_at=registered_at,
        ticker=ticker,
        side=side,
        quantity=quantity,
        price=price,
        fee=fee,
        note=note,
        cash_change=cash_change,
        edited_at=edited_at,
    )


def _parse_adjustment(data: Any, index: int) -> CashAdjustment:
    if not isinstance(data, dict):
        raise JournalError(f"Saldojustering nummer {index} er ikke et JSON-objekt.")
    try:
        adjustment_id = int(data.get("id", index))
        changed_at = _as_local_datetime(data.get("changed_at"), "changed_at")
        previous_cash = _number(data.get("previous_cash"), "Forrige saldo")
        new_cash = _number(data.get("new_cash"), "Ny saldo")
        note = _clean_note(data.get("note", ""))
    except JournalError as exc:
        raise JournalError(f"Saldojustering nummer {index}: {exc}") from exc
    return CashAdjustment(
        id=adjustment_id,
        changed_at=changed_at,
        previous_cash=_money(previous_cash),
        new_cash=_money(new_cash),
        note=note,
    )


def journal_from_payload(
    data: Any,
    default_cash: float = 5_000.0,
) -> Journal:
    """Bygg en validert dagbok fra JSON-formatet som lagres på disk."""
    if not isinstance(data, dict):
        raise JournalError("Dagboken må inneholde et JSON-objekt.")
    if not isinstance(data.get("trades", []), list):
        raise JournalError("Feltet trades må være en liste.")
    if not isinstance(data.get("adjustments", []), list):
        raise JournalError("Feltet adjustments må være en liste.")
    try:
        cash = _number(data.get("available_cash", default_cash), "Ledig kapital")
        trades = tuple(
            _parse_trade(item, index)
            for index, item in enumerate(data.get("trades", []), 1)
        )
        adjustments = tuple(
            _parse_adjustment(item, index)
            for index, item in enumerate(data.get("adjustments", []), 1)
        )
        updated_at = _as_local_datetime(data.get("updated_at"), "updated_at")
        next_id = int(data.get("next_id", 1))
        version = int(data.get("version", 1))
    except (TypeError, ValueError) as exc:
        if isinstance(exc, JournalError):
            raise
        raise JournalError(f"Ugyldig dagbok: {exc}") from exc
    highest_id = max(
        [item.id for item in trades] + [item.id for item in adjustments] + [0]
    )
    next_id = max(1, next_id, highest_id + 1)
    return Journal(
        available_cash=_money(cash),
        trades=trades,
        adjustments=adjustments,
        updated_at=updated_at,
        next_id=next_id,
        version=version,
    )


def load_journal(
    path: str | Path = DEFAULT_JOURNAL_PATH,
    default_cash: float = 5_000.0,
) -> Journal:
    """Les dagboken. En manglende fil gir en tom dagbok med startkapital."""
    file_path = Path(path)
    if not file_path.exists():
        return Journal(
            available_cash=_money(default_cash),
            trades=(),
            adjustments=(),
            updated_at=_local_now(),
        )
    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise JournalError(f"Kunne ikke lese dagboken {file_path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise JournalError(f"Ugyldig JSON i dagboken {file_path}: {exc}") from exc
    return journal_from_payload(data, default_cash=default_cash)


def journal_payload(journal: Journal) -> dict[str, Any]:
    """JSON-formatet som lagres på disk."""
    return {
        "version": 1,
        "available_cash": _money(journal.available_cash),
        "updated_at": journal.updated_at.isoformat(),
        "next_id": journal.next_id,
        "trades": [
            {
                "id": item.id,
                "executed_at": item.executed_at.isoformat(),
                "registered_at": item.registered_at.isoformat(),
                "ticker": item.ticker,
                "side": item.side,
                "quantity": item.quantity,
                "price": item.price,
                "fee": item.fee,
                "cash_change": item.cash_change,
                "note": item.note,
                "edited_at": (
                    item.edited_at.isoformat() if item.edited_at else None
                ),
            }
            for item in journal.trades
        ],
        "adjustments": [
            {
                "id": item.id,
                "changed_at": item.changed_at.isoformat(),
                "previous_cash": item.previous_cash,
                "new_cash": item.new_cash,
                "note": item.note,
            }
            for item in journal.adjustments
        ],
    }


def save_journal(
    journal: Journal,
    path: str | Path = DEFAULT_JOURNAL_PATH,
) -> Path:
    """Lagre dagboken atomisk. Tidligere innhold erstattes av den nye tilstanden."""
    file_path = Path(path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = file_path.with_suffix(file_path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(journal_payload(journal), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(file_path)
    return file_path


def _prepare_trade(
    *,
    trade_id: int,
    ticker: str,
    side: str,
    quantity: int,
    price: float,
    fee: float,
    note: str,
    executed_at: datetime | str | None,
    registered_at: datetime,
    edited_at: Optional[datetime] = None,
) -> TradeEntry:
    normalized_ticker = _normalize_ticker(ticker)
    normalized_side = str(side or "").strip().lower()
    if normalized_side not in {"buy", "sell"}:
        raise JournalError("Handelens side må være buy eller sell.")
    shares = _whole_shares(quantity)
    share_price = _number(price, "Kurs", minimum=0.0001)
    commission = _number(fee, "Kurtasje")
    cleaned_note = _clean_note(note)
    executed = _as_local_datetime(executed_at, "Handelsdato")
    gross = _money(shares * share_price)
    cash_change = _money(
        -gross - commission
        if normalized_side == "buy"
        else gross - commission
    )
    if normalized_side == "sell" and cash_change < 0:
        raise JournalError("Kurtasjen er større enn salgssummen.")
    return TradeEntry(
        id=trade_id,
        executed_at=executed,
        registered_at=registered_at,
        ticker=normalized_ticker,
        side=normalized_side,
        quantity=shares,
        price=share_price,
        fee=commission,
        note=cleaned_note,
        cash_change=cash_change,
        edited_at=edited_at,
    )


def record_trade(
    journal: Journal,
    *,
    ticker: str,
    side: str,
    quantity: int,
    price: float,
    fee: float = 0.0,
    note: str = "",
    executed_at: datetime | str | None = None,
    registered_at: datetime | None = None,
) -> Journal:
    """Legg til en utført handel og oppdater ledig kapital.

    Kjøp reduserer saldoen med kjøpesum pluss kurtasje. Salg øker saldoen med
    salgssum minus kurtasje. Funksjonen lagrer ikke selv.
    """
    registered = registered_at or _local_now()
    trade = _prepare_trade(
        trade_id=journal.next_id,
        ticker=ticker,
        side=side,
        quantity=quantity,
        price=price,
        fee=fee,
        note=note,
        executed_at=executed_at,
        registered_at=registered,
    )
    if trade.side == "buy" and trade.cash_change < -journal.available_cash - 0.005:
        shortfall = abs(trade.cash_change) - journal.available_cash
        raise JournalError(
            f"For lite ledig kapital. Kjøpet koster {trade.gross + trade.fee:.2f} kr, "
            f"og du har {journal.available_cash:.2f} kr. Mangler {shortfall:.2f} kr."
        )
    return replace(
        journal,
        available_cash=_money(journal.available_cash + trade.cash_change),
        trades=journal.trades + (trade,),
        updated_at=registered,
        next_id=journal.next_id + 1,
    )


def update_trade(
    journal: Journal,
    trade_id: int,
    *,
    ticker: str,
    side: str,
    quantity: int,
    price: float,
    fee: float = 0.0,
    note: str = "",
    executed_at: datetime | str | None = None,
) -> Journal:
    """Rediger en registrert handel og juster ledig kapital med differansen.

    Saldoen endres bare med forskjellen mellom gammel og ny kontantstrøm, slik
    at senere handler og manuelle saldojusteringer beholdes. Funksjonen lagrer
    ikke selv. En redigering som gir negativ ledig kapital avvises.
    """
    index = next(
        (position for position, item in enumerate(journal.trades) if item.id == trade_id),
        None,
    )
    if index is None:
        raise JournalError(f"Fant ikke handel nummer {trade_id}.")
    old_trade = journal.trades[index]
    now = _local_now()
    updated = _prepare_trade(
        trade_id=old_trade.id,
        ticker=ticker,
        side=side,
        quantity=quantity,
        price=price,
        fee=fee,
        note=note,
        executed_at=executed_at,
        registered_at=old_trade.registered_at,
        edited_at=now,
    )
    difference = _money(updated.cash_change - old_trade.cash_change)
    new_cash = _money(journal.available_cash + difference)
    if new_cash < -0.005:
        raise JournalError(
            "Endringen ville gitt negativ ledig kapital "
            f"({new_cash:.2f} kr). Korriger saldoen eller en senere handel først."
        )
    trades = list(journal.trades)
    trades[index] = updated
    return replace(
        journal,
        available_cash=max(0.0, new_cash),
        trades=tuple(trades),
        updated_at=now,
    )


def set_available_cash(
    journal: Journal,
    amount: float,
    note: str = "",
    changed_at: datetime | None = None,
) -> Journal:
    """Sett ledig kapital manuelt og logg endringen. Funksjonen lagrer ikke selv."""
    new_cash = _money(_number(amount, "Ledig kapital"))
    cleaned_note = _clean_note(note)
    changed = changed_at or _local_now()
    adjustment = CashAdjustment(
        id=journal.next_id,
        changed_at=changed,
        previous_cash=_money(journal.available_cash),
        new_cash=new_cash,
        note=cleaned_note,
    )
    return replace(
        journal,
        available_cash=new_cash,
        adjustments=journal.adjustments + (adjustment,),
        updated_at=changed,
        next_id=journal.next_id + 1,
    )


def summarize_journal(journal: Journal) -> JournalSummary:
    """Beregn beholdning, realisert resultat og kostnader fra loggen."""
    positions: dict[str, list[float]] = {}
    realized = 0.0
    fees = 0.0
    turnover = 0.0
    buys = 0
    sells = 0
    for trade in sorted(journal.trades, key=lambda item: (item.executed_at, item.id)):
        fees += trade.fee
        turnover += trade.quantity * trade.price
        position = positions.setdefault(trade.ticker, [0.0, 0.0])
        if trade.side == "buy":
            buys += 1
            position[0] += trade.quantity
            position[1] += trade.quantity * trade.price + trade.fee
            if position[0] <= 0:
                # En tidligere registrert short/negativ beholdning skal ikke gi
                # en kunstig kostpris når den dekkes inn senere.
                position[1] = 0.0
            continue
        sells += 1
        proceeds = trade.quantity * trade.price - trade.fee
        if position[0] > 0:
            average = position[1] / position[0]
            cost_removed = min(position[1], average * trade.quantity)
            realized += proceeds - cost_removed
            position[0] -= trade.quantity
            position[1] = max(0.0, position[1] - cost_removed)
        else:
            # Salg uten registrert kjøp er mulig hvis dagboken starter midt i en
            # posisjon. Da finnes ingen kostpris, og hele provenyet vises som
            # realisert til brukeren har lagt inn en historisk inngang.
            realized += proceeds
            position[0] -= trade.quantity
        if position[0] <= 0:
            position[1] = 0.0
    holdings = tuple(
        Holding(ticker=ticker, quantity=int(position[0]), cost_basis=_money(position[1]))
        for ticker, position in sorted(positions.items())
        if int(position[0]) != 0
    )
    return JournalSummary(
        available_cash=_money(journal.available_cash),
        holdings=holdings,
        realized_profit=_money(realized),
        total_fees=_money(fees),
        total_turnover=_money(turnover),
        buy_count=buys,
        sell_count=sells,
    )


def with_available_cash(settings: Settings, cash: float) -> Settings:
    """Lag en kopi av innstillingene der handelsplanen bruker dagens saldo."""
    return replace(settings, trade=replace(settings.trade, capital=_money(cash)))


def journal_api_payload(journal: Journal) -> dict[str, Any]:
    """Sammendrag for API og fremtidig eksport."""
    summary = summarize_journal(journal)
    return {
        "available_cash": summary.available_cash,
        "updated_at": journal.updated_at.isoformat(),
        "realized_profit": summary.realized_profit,
        "total_fees": summary.total_fees,
        "total_turnover": summary.total_turnover,
        "buy_count": summary.buy_count,
        "sell_count": summary.sell_count,
        "holdings": [
            {
                "ticker": item.ticker,
                "quantity": item.quantity,
                "cost_basis": item.cost_basis,
                "average_cost": (
                    None if item.average_cost is None else round(item.average_cost, 4)
                ),
            }
            for item in summary.holdings
        ],
        "trades": [
            {
                "id": item.id,
                "executed_at": item.executed_at.isoformat(),
                "ticker": item.ticker,
                "side": item.side,
                "quantity": item.quantity,
                "price": item.price,
                "fee": item.fee,
                "cash_change": item.cash_change,
                "note": item.note,
                "edited_at": (
                    item.edited_at.isoformat() if item.edited_at else None
                ),
            }
            for item in journal.trades
        ],
        "adjustments": [
            {
                "id": item.id,
                "changed_at": item.changed_at.isoformat(),
                "previous_cash": item.previous_cash,
                "new_cash": item.new_cash,
                "difference": item.difference,
                "note": item.note,
            }
            for item in journal.adjustments
        ],
    }

