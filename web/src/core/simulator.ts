import { settingsForCapital, type Settings } from "./config";
import {
  buildEtradeReport,
  ETRADE_RUNNER_MAX_HOLDING_DAYS,
  etradeExitQuantities,
  etradeLevelsForEntry,
} from "./etrade";
import { tradingDaysHeld } from "./journal";
import { buildMarketReport } from "./report";
import { DEFAULT_CRITERIA, screen } from "./screen";
import type { MarketSnapshot } from "./snapshot";
import { SWING_MAX_HOLDING_DAYS } from "./swing";
import type { Stock } from "./types";

/**
 * Forward paper trading for the two report modes.
 *
 * The simulator only decides long trades and never talks to a broker. Each
 * mode has its own 5 000 kr portfolio and can hold at most one stock at a time.
 * The Edge Function calls this module every ten minutes while Oslo Børs is open,
 * so the same core rules used by the app are applied to the paper portfolio.
 */
export const SIM_STARTING_CASH = 5_000;

export type SimMode = "swing" | "etrade";

export interface SimTarget {
  label: string;
  price: number;
}

export interface SimPosition {
  ticker: string;
  shares: number;
  originalShares: number;
  entryPrice: number;
  entryFee: number;
  entryAt: string;
  stopPrice: number;
  stopPct: number;
  targetPrice: number | null;
  targets: SimTarget[];
  stage: number;
  highestPrice: number;
  lastPrice: number;
  maxHoldingDays: number;
  reason: string;
}

export interface SimPendingOrder {
  ticker: string;
  shares: number;
  trigger: number;
  invalidation: number | null;
  stopPrice: number;
  stopPct: number;
  targetPrice: number | null;
  targets: SimTarget[];
  maxHoldingDays: number;
  score: number;
  createdAt: string;
  reason: string;
}

export interface SimPortfolioState {
  cash: number;
  position: SimPosition | null;
  pending: SimPendingOrder | null;
}

export interface SimTrade {
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
  reason: string;
  realizedPnl: number | null;
}

export interface SimEquity {
  cash: number;
  positionValue: number;
  equity: number;
}

export interface SimPortfolioResult {
  mode: SimMode;
  state: SimPortfolioState;
  trades: SimTrade[];
  equity: SimEquity;
}

export interface SimulatorInput {
  snapshot: MarketSnapshot;
  settings: Settings;
  states: Partial<Record<SimMode, SimPortfolioState>>;
  now?: Date;
  today?: string;
}

interface TickContext {
  mode: SimMode;
  snapshot: MarketSnapshot;
  settings: Settings;
  now: Date;
  today: string;
  state: SimPortfolioState;
  trades: SimTrade[];
  sold: boolean;
  /** Set when an existing pending order is cancelled this tick. Prevents an
   * immediate re-entry for the same setup before the market has had time to
   * confirm or reject it. */
  pendingClosed: boolean;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function emptyPortfolioState(cash = SIM_STARTING_CASH): SimPortfolioState {
  return { cash: money(cash), position: null, pending: null };
}

function stockFor(
  snapshot: MarketSnapshot,
  ticker: string,
): Stock | null {
  return (
    snapshot.universe.stocks.find((stock) => stock.ticker === ticker) ?? null
  );
}

function sellQuantity(position: SimPosition, requested: number): number {
  return Math.max(0, Math.min(position.shares, Math.floor(requested)));
}

function executeBuy(
  context: TickContext,
  input: {
    ticker: string;
    shares: number;
    price: number;
    fee: number;
    reason: string;
    stopPrice: number;
    stopPct: number;
    targetPrice: number | null;
    targets: SimTarget[];
    maxHoldingDays: number;
    stage?: number;
  },
): boolean {
  const { state } = context;
  if (state.position !== null || input.shares <= 0 || input.price <= 0) {
    return false;
  }
  // A pending trigger can fill above its planned entry. Cap the order to what
  // the cash balance can actually pay for instead of rejecting the whole buy.
  const affordable = Math.floor((state.cash - input.fee) / input.price);
  const shares = Math.min(input.shares, affordable);
  if (shares <= 0) {
    return false;
  }
  const gross = shares * input.price;
  const totalCost = money(gross + input.fee);
  if (totalCost > state.cash + 0.005) {
    return false;
  }
  state.cash = money(state.cash - totalCost);
  state.position = {
    ticker: input.ticker,
    shares,
    originalShares: shares,
    entryPrice: input.price,
    entryFee: input.fee,
    entryAt: context.now.toISOString(),
    stopPrice: input.stopPrice,
    stopPct: input.stopPct,
    targetPrice: input.targetPrice,
    targets: input.targets,
    stage: input.stage ?? 0,
    highestPrice: input.price,
    lastPrice: input.price,
    maxHoldingDays: input.maxHoldingDays,
    reason: input.reason,
  };
  state.pending = null;
  context.trades.push({
    ticker: input.ticker,
    side: "buy",
    quantity: shares,
    price: input.price,
    fee: input.fee,
    executedAt: context.now.toISOString(),
    reason: input.reason,
    realizedPnl: null,
  });
  return true;
}

function executeSell(
  context: TickContext,
  input: {
    quantity: number;
    price: number;
    fee: number;
    reason: string;
  },
): void {
  const { state } = context;
  const position = state.position;
  if (position === null) {
    return;
  }
  const quantity = sellQuantity(position, input.quantity);
  if (quantity <= 0) {
    return;
  }
  const proceeds = money(quantity * input.price - input.fee);
  context.sold = true;
  const allocatedBuyFee =
    position.originalShares > 0
      ? (position.entryFee * quantity) / position.originalShares
      : 0;
  const realized = money(
    quantity * (input.price - position.entryPrice) - input.fee - allocatedBuyFee,
  );
  state.cash = money(state.cash + proceeds);
  context.trades.push({
    ticker: position.ticker,
    side: "sell",
    quantity,
    price: input.price,
    fee: input.fee,
    executedAt: context.now.toISOString(),
    reason: input.reason,
    realizedPnl: realized,
  });
  if (quantity >= position.shares) {
    state.position = null;
    return;
  }
  position.shares -= quantity;
  position.lastPrice = input.price;
}

function updatePrice(position: SimPosition, stock: Stock | null): number {
  const price =
    stock !== null && Number.isFinite(stock.close) && stock.close > 0
      ? stock.close
      : position.lastPrice;
  position.lastPrice = price;
  position.highestPrice = Math.max(position.highestPrice, price);
  return price;
}

function swingReport(context: TickContext) {
  const settings = settingsForCapital(context.settings, context.state.cash);
  const result = screen(context.snapshot.universe.stocks, DEFAULT_CRITERIA);
  return buildMarketReport(
    result.matches,
    DEFAULT_CRITERIA,
    context.snapshot.universe,
    context.snapshot.news,
    settings,
    context.today,
    context.now,
  );
}

function etradeReport(context: TickContext) {
  const settings = settingsForCapital(context.settings, context.state.cash);
  const result = screen(context.snapshot.universe.stocks, DEFAULT_CRITERIA);
  return buildEtradeReport(
    result.matches,
    context.snapshot.universe,
    context.snapshot.news,
    settings,
    context.today,
    context.now,
  );
}

function manageSwing(context: TickContext): void {
  const { state, settings } = context;
  const position = state.position;
  if (position === null) {
    return;
  }
  const stock = stockFor(context.snapshot, position.ticker);
  const price = updatePrice(position, stock);
  position.stopPrice = Math.max(
    position.stopPrice,
    money(position.highestPrice * (1 - position.stopPct)),
  );

  if (price <= position.stopPrice) {
    executeSell(context, {
      quantity: position.shares,
      price,
      fee: settings.trade.sellFee,
      reason: "Stop",
    });
    return;
  }
  if (position.targetPrice !== null && price >= position.targetPrice) {
    executeSell(context, {
      quantity: position.shares,
      price,
      fee: settings.trade.sellFee,
      reason: "Mål",
    });
    return;
  }
  const held = tradingDaysHeld(position.entryAt, context.now) ?? 0;
  if (held >= position.maxHoldingDays) {
    executeSell(context, {
      quantity: position.shares,
      price,
      fee: settings.trade.sellFee,
      reason: "Tidsstopp",
    });
  }
}

function openSwing(context: TickContext): void {
  const { state, settings } = context;
  if (context.sold || state.position !== null || state.pending !== null) {
    return;
  }
  const report = swingReport(context);
  const main = report.main;
  if (main === null) {
    return;
  }
  const stock = main.candidate.stock;
  const price = stock.close;
  const plan = main.trade;
  if (
    !plan.feasible ||
    plan.shares <= 0 ||
    price <= 0 ||
    plan.targetPrice <= 0 ||
    plan.stopPrice <= 0
  ) {
    return;
  }
  const categories =
    main.candidate.categories.length > 0
      ? main.candidate.categories.join(", ")
      : "hovedkandidat";
  const reason = `Swing: ${stock.ticker} – ${categories} (score ${main.candidate.score.toFixed(0)})`;
  executeBuy(context, {
    ticker: stock.ticker,
    shares: plan.shares,
    price,
    fee: settings.trade.buyFee,
    reason,
    stopPrice: plan.stopPrice,
    stopPct: plan.stopPct ?? 1 - plan.stopPrice / price,
    targetPrice: plan.targetPrice,
    targets: [],
    maxHoldingDays: plan.maxHoldingDays ?? SWING_MAX_HOLDING_DAYS,
  });
}

function manageEtrade(context: TickContext): void {
  const { state, settings } = context;
  const position = state.position;
  if (position === null) {
    return;
  }
  const stock = stockFor(context.snapshot, position.ticker);
  const price = updatePrice(position, stock);

  if (position.stage >= 3) {
    position.stopPrice = Math.max(
      position.stopPrice,
      money(position.highestPrice * (1 - position.stopPct)),
    );
  }

  if (price <= position.stopPrice) {
    executeSell(context, {
      quantity: position.shares,
      price,
      fee: settings.trade.sellFee,
      reason: "Stop",
    });
    return;
  }

  while (state.position !== null && state.position.stage < state.position.targets.length) {
    const current = state.position;
    const target = current.targets[current.stage];
    if (target === undefined || price < target.price) {
      break;
    }
    const plannedExit = etradeExitQuantities(current.originalShares)[current.stage];
    const quantity = Math.min(
      current.shares,
      plannedExit ?? current.shares,
    );
    executeSell(context, {
      quantity,
      price,
      fee: settings.trade.sellFee,
      reason: target.label,
    });
    if (state.position !== null) {
      state.position.stage += 1;
      if (state.position.stage === 1) {
        state.position.stopPrice = Math.max(
          state.position.stopPrice,
          state.position.entryPrice,
        );
      } else if (state.position.stage === 2) {
        const firstTarget = state.position.targets[0];
        if (firstTarget) {
          state.position.stopPrice = Math.max(
            state.position.stopPrice,
            firstTarget.price,
          );
        }
      } else if (state.position.stage === 3) {
        const secondTarget = state.position.targets[1];
        state.position.maxHoldingDays = ETRADE_RUNNER_MAX_HOLDING_DAYS;
        state.position.stopPrice = Math.max(
          state.position.stopPrice,
          secondTarget?.price ?? state.position.entryPrice,
          state.position.highestPrice * (1 - state.position.stopPct),
        );
      }
    }
  }

  if (state.position === null) {
    return;
  }
  const held = tradingDaysHeld(state.position.entryAt, context.now) ?? 0;
  if (held >= state.position.maxHoldingDays) {
    executeSell(context, {
      quantity: state.position.shares,
      price,
      fee: settings.trade.sellFee,
      reason: "Tidsstopp",
    });
  }
}

function openEtrade(context: TickContext): void {
  const { state, settings } = context;
  if (context.sold || state.position !== null) {
    return;
  }

  const report = etradeReport(context);
  const best = report.ideas[0] ?? null;
  if (state.pending !== null) {
    const pending = state.pending;
    const stillValid = report.ideas.some(
      (idea) => idea.candidate.stock.ticker === pending.ticker,
    );
    if (!stillValid) {
      state.pending = null;
      context.pendingClosed = true;
    } else {
      const stock = stockFor(context.snapshot, pending.ticker);
      if (stock === null) {
        state.pending = null;
        context.pendingClosed = true;
      } else {
        const price = stock.close;
        if (price >= pending.trigger) {
          const levels = etradeLevelsForEntry(price, pending.stopPct);
          executeBuy(context, {
            ticker: pending.ticker,
            shares: pending.shares,
            price,
            fee: settings.trade.buyFee,
            reason: `${pending.reason} (trigger)`,
            stopPrice: levels.stopPrice,
            stopPct: pending.stopPct,
            targetPrice: pending.targetPrice,
            targets: levels.targets.map(({ label, price: targetPrice }) => ({
              label,
              price: targetPrice,
            })),
            maxHoldingDays: pending.maxHoldingDays,
          });
          return;
        }
        if (
          pending.invalidation !== null &&
          price <= pending.invalidation
        ) {
          state.pending = null;
          context.pendingClosed = true;
        } else if (
          (tradingDaysHeld(pending.createdAt, context.now) ?? 0) >=
          pending.maxHoldingDays
        ) {
          state.pending = null;
          context.pendingClosed = true;
        } else {
          return;
        }
      }
    }
  }

  if (
    context.pendingClosed ||
    state.position !== null ||
    state.pending !== null ||
    best === null
  ) {
    return;
  }
  const stock = best.candidate.stock;
  const price = stock.close;
  if (best.invalidation !== null && price <= best.invalidation) {
    return;
  }
  const reason = `Etrade: ${stock.ticker} – ${best.setupLabel} (score ${best.score.toFixed(0)})`;
  if (price >= best.trigger) {
    const levels = etradeLevelsForEntry(price, best.stopPct);
    executeBuy(context, {
      ticker: stock.ticker,
      shares: best.shares,
      price,
      fee: settings.trade.buyFee,
      reason: `${reason} (trigger)`,
      stopPrice: levels.stopPrice,
      stopPct: best.stopPct,
      targetPrice: null,
      targets: levels.targets.map((target) => ({
        label: target.label,
        price: target.price,
      })),
      maxHoldingDays: best.horizonDays,
    });
    return;
  }
  state.pending = {
    ticker: stock.ticker,
    shares: best.shares,
    trigger: best.trigger,
    invalidation: best.invalidation,
    stopPrice: best.stopPrice,
    stopPct: best.stopPct,
    targetPrice: null,
    targets: best.targets.map((target) => ({
      label: target.label,
      price: target.price,
    })),
    maxHoldingDays: best.horizonDays,
    score: best.score,
    createdAt: context.now.toISOString(),
    reason,
  };
}

function tick(
  mode: SimMode,
  state: SimPortfolioState,
  snapshot: MarketSnapshot,
  settings: Settings,
  now: Date,
  today: string,
): SimPortfolioResult {
  const context: TickContext = {
    mode,
    snapshot,
    settings,
    now,
    today,
    state: {
      cash: money(state.cash),
      position: state.position === null ? null : { ...state.position },
      pending: state.pending === null ? null : { ...state.pending },
    },
    trades: [],
    sold: false,
    pendingClosed: false,
  };

  if (mode === "swing") {
    manageSwing(context);
    openSwing(context);
  } else {
    manageEtrade(context);
    openEtrade(context);
  }

  const positionValue =
    context.state.position === null
      ? 0
      : money(
          context.state.position.shares * context.state.position.lastPrice,
        );
  return {
    mode,
    state: context.state,
    trades: context.trades,
    equity: {
      cash: money(context.state.cash),
      positionValue,
      equity: money(context.state.cash + positionValue),
    },
  };
}

/**
 * Runs one simulated tick for both modes. The caller is responsible for only
 * invoking this while the market is open and the snapshot is fresh.
 */
export function runSimulatorTick(input: SimulatorInput): SimPortfolioResult[] {
  const now = input.now ?? new Date();
  const today = input.today ?? now.toISOString().slice(0, 10);
  const results: SimPortfolioResult[] = [];
  for (const mode of ["swing", "etrade"] as const) {
    const state = input.states[mode] ?? emptyPortfolioState();
    results.push(tick(mode, state, input.snapshot, input.settings, now, today));
  }
  return results;
}
