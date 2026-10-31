"""Formatering av tall og datoer på norsk."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

DASH = "–"


def _nb(value: float, digits: int) -> str:
    """Desimaltall med komma som desimalskilletegn."""
    return f"{value:.{digits}f}".replace(".", ",")


def format_pct(value: Optional[float], digits: int = 1, signed: bool = True) -> str:
    """0.0123 -> «+1,2 %». None -> «–»."""
    if value is None:
        return DASH
    text = _nb(value * 100.0, digits)
    if signed and value > 0:
        text = "+" + text
    return f"{text} %"


def format_price(value: Optional[float], digits: int = 2) -> str:
    if value is None:
        return DASH
    return _nb(value, digits)


def format_number(value: Optional[float], digits: int = 0) -> str:
    if value is None:
        return DASH
    rounded = f"{value:,.{digits}f}"
    return rounded.replace(",", " ").replace(".", ",")


def format_money(value: Optional[float], digits: int = 0, signed: bool = False) -> str:
    """Kroner med norsk tusenskille, f.eks. «4 913 kr»."""
    if value is None:
        return DASH
    text = format_number(value, digits)
    if signed and value > 0:
        text = "+" + text
    return f"{text} kr"


def format_market_cap(value: Optional[float]) -> str:
    """Markedsverdi i kompakt norsk form, f.eks. «1,1 mrd»."""
    if value is None:
        return DASH
    magnitude = abs(value)
    if magnitude >= 1e12:
        return f"{_nb(value / 1e12, 1)} bill."
    if magnitude >= 1e9:
        return f"{_nb(value / 1e9, 1)} mrd."
    if magnitude >= 1e6:
        return f"{_nb(value / 1e6, 0)} mill."
    if magnitude >= 1e3:
        return f"{_nb(value / 1e3, 0)} k"
    return _nb(value, 0)


def format_datetime(value: datetime) -> str:
    """Tidspunkt i lokal tidssonen, norsk format."""
    local = value.astimezone()
    return local.strftime("%d.%m.%Y kl. %H:%M")


def format_date(value: Optional[date]) -> str:
    """Dato på norsk format, f.eks. «04.02.2027»."""
    if value is None:
        return DASH
    return value.strftime("%d.%m.%Y")


def days_until(value: Optional[date], today: Optional[date] = None) -> Optional[int]:
    """Antall dager fra i dag til datoen. None når datoen mangler."""
    if value is None:
        return None
    if today is None:
        today = datetime.now().astimezone().date()
    return (value - today).days


def format_days_until(value: Optional[date], today: Optional[date] = None) -> str:
    """«i dag», «1 dag», «14 d» eller «–»."""
    days = days_until(value, today)
    if days is None or days < 0:
        return DASH
    if days == 0:
        return "i dag"
    if days == 1:
        return "1 dag"
    return f"{days} d"
