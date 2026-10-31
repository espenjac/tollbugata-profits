"""Beregning av antall aksjer, kurtasje og gevinst/tap-scenarioer."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Optional

from .config import TradeConfig


@dataclass(frozen=True)
class TradeScenario:
    change_pct: float
    exit_price: float
    gross_profit: float
    net_profit: float
    net_return_pct: float


@dataclass(frozen=True)
class TradePlan:
    """En enkel manuell handelsplan. Ingen ordre sendes automatisk."""

    capital: float
    buy_fee: float
    sell_fee: float
    entry_price: float
    shares: int
    invested: float
    cash_left: float
    total_cost: float
    target_price: float
    target_net: float
    target_return_pct: float
    stop_price: float
    stop_net: float
    stop_return_pct: float
    reward_risk: Optional[float]
    scenarios: tuple[TradeScenario, ...]

    @property
    def feasible(self) -> bool:
        return self.shares > 0


def build_trade_plan(
    price: float,
    config: TradeConfig,
    scenario_pcts: Optional[Iterable[float]] = None,
) -> TradePlan:
    """Beregn en handel med hele den tilgjengelige kapitalen.

    Prisen er siste kjente sluttkurs. Slippage legges på kjøpskursen og trekkes
    fra salgskursen. Antall aksjer rundes ned fordi Oslo Børs ikke handler
    brøkdeler av aksjer i denne sammenhengen.
    """
    if price <= 0:
        return _empty_plan(config, price)
    buy_price = price * (1.0 + max(0.0, config.slippage_pct))
    budget = max(0.0, config.capital - config.buy_fee)
    shares = int(math.floor(budget / buy_price))
    if shares <= 0:
        return _empty_plan(config, price)

    invested = shares * buy_price
    total_cost = invested + config.buy_fee
    cash_left = config.capital - total_cost
    target_price = buy_price * (1.0 + config.target_pct)
    stop_price = buy_price * (1.0 - config.stop_loss_pct)
    target_net = _net_result(shares, buy_price, target_price, config)
    stop_net = _net_result(shares, buy_price, stop_price, config)
    reward_risk = (
        target_net / abs(stop_net)
        if stop_net < 0 and target_net > 0
        else None
    )

    pcts = tuple(scenario_pcts if scenario_pcts is not None else config.scenario_pcts)
    scenarios = tuple(
        _scenario(shares, buy_price, config, change)
        for change in pcts
    )
    return TradePlan(
        capital=config.capital,
        buy_fee=config.buy_fee,
        sell_fee=config.sell_fee,
        entry_price=buy_price,
        shares=shares,
        invested=invested,
        cash_left=cash_left,
        total_cost=total_cost,
        target_price=target_price,
        target_net=target_net,
        target_return_pct=target_net / total_cost * 100.0 if total_cost else 0.0,
        stop_price=stop_price,
        stop_net=stop_net,
        stop_return_pct=stop_net / total_cost * 100.0 if total_cost else 0.0,
        reward_risk=reward_risk,
        scenarios=scenarios,
    )


def _net_result(shares: int, buy_price: float, sell_price: float, config: TradeConfig) -> float:
    sell_price = max(0.0, sell_price) * (1.0 - max(0.0, config.slippage_pct))
    return shares * sell_price - config.sell_fee - shares * buy_price - config.buy_fee


def _scenario(
    shares: int,
    buy_price: float,
    config: TradeConfig,
    change: float,
) -> TradeScenario:
    exit_price = buy_price * (1.0 + change)
    gross = shares * (exit_price - buy_price)
    net = _net_result(shares, buy_price, exit_price, config)
    total_cost = shares * buy_price + config.buy_fee
    return TradeScenario(
        change_pct=change,
        exit_price=exit_price,
        gross_profit=gross,
        net_profit=net,
        net_return_pct=net / total_cost * 100.0 if total_cost else 0.0,
    )


def _empty_plan(config: TradeConfig, price: float) -> TradePlan:
    return TradePlan(
        capital=config.capital,
        buy_fee=config.buy_fee,
        sell_fee=config.sell_fee,
        entry_price=price,
        shares=0,
        invested=0.0,
        cash_left=config.capital,
        total_cost=0.0,
        target_price=0.0,
        target_net=0.0,
        target_return_pct=0.0,
        stop_price=0.0,
        stop_net=0.0,
        stop_return_pct=0.0,
        reward_risk=None,
        scenarios=(),
    )


def simulate_net(
    entry: float,
    exit_price: float,
    config: TradeConfig,
) -> tuple[int, float, float]:
    """Returner (antall aksjer, nettoresultat, nettoavkastning i prosent).

    ``entry`` er rå inngangskurs før konfigurert kjøpsslippage. Funksjonen
    legger på kjøpsslippage og trekker fra salgsslippage, slik at backtesten
    bruker samme kostnadsmodell som handelsplanen.
    """
    if entry <= 0:
        return 0, 0.0, 0.0
    buy_price = entry * (1.0 + max(0.0, config.slippage_pct))
    shares = int(math.floor((config.capital - config.buy_fee) / buy_price))
    if shares <= 0:
        return 0, 0.0, 0.0
    net = _net_result(shares, buy_price, exit_price, config)
    total_cost = shares * buy_price + config.buy_fee
    return shares, net, (net / total_cost * 100.0 if total_cost else 0.0)
