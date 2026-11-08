import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "./config";
import { emptyNewsFeed } from "./news";
import {
  emptyPortfolioState,
  runSimulatorTick,
  SIM_STARTING_CASH,
  type SimPortfolioState,
  type SimPosition,
  type SimTrade,
  type SimTarget,
} from "./simulator";
import type { MarketSnapshot } from "./snapshot";
import type { Stock, Universe } from "./types";

const NOW = new Date("2026-11-05T10:00:00+01:00");
const TODAY = "2026-11-05";

function makeStock(overrides: Partial<Stock> = {}): Stock {
  return {
    ticker: "TEST",
    name: "Test ASA",
    close: 100,
    currency: "NOK",
    weekReturn: 0.05,
    monthReturn: 0.1,
    quarterReturn: 0.15,
    sma5: 98,
    sma20: 95,
    sma50: 90,
    rsi: 60,
    ath: 120,
    high52w: 120,
    marketCap: 1_000_000_000,
    volume: 1_000_000,
    sector: "Teknologi",
    instrumentType: "stock",
    market: "oslo",
    earningsDate: null,
    exDividendDate: null,
    averageVolume10d: 800_000,
    atr: 3,
    dayReturn: 0.01,
    open: 100,
    high: 101,
    low: 98,
    vwap: 100.5,
    ...overrides,
  };
}

/** A stock that fails the swing screen so only position management runs. */
function passiveStock(overrides: Partial<Stock> = {}): Stock {
  return makeStock({
    ticker: "HOLD",
    weekReturn: -0.05,
    rsi: 80,
    ...overrides,
  });
}

function makeSnapshot(stocks: Stock[], now: Date = NOW): MarketSnapshot {
  const universe: Universe = {
    stocks,
    fetchedAt: now,
    source: "live",
    warning: null,
    growthTickers: new Set(),
    growthSource: "live",
    growthWarning: null,
  };
  return {
    universe,
    news: emptyNewsFeed(now, new Date(now.getTime() - 864e5), null),
    benchmark: null,
    generatedAt: now,
  };
}

function run(
  states: Partial<Record<"swing" | "etrade", SimPortfolioState>>,
  snapshot: MarketSnapshot,
  now: Date = NOW,
  settings: Settings = DEFAULT_SETTINGS,
) {
  return runSimulatorTick({ snapshot, settings, states, now, today: TODAY });
}

function seedPosition(
  overrides: Partial<SimPosition> = {},
): SimPortfolioState {
  return {
    cash: 0,
    pending: null,
    position: {
      ticker: "HOLD",
      shares: 40,
      originalShares: 40,
      entryPrice: 100,
      entryFee: 29,
      entryAt: "2026-11-05T09:30:00.000Z",
      stopPrice: 95,
      stopPct: 0.05,
      targetPrice: 110,
      targets: [],
      stage: 0,
      highestPrice: 100,
      lastPrice: 100,
      maxHoldingDays: 5,
      reason: "seed",
      ...overrides,
    },
  };
}

function tradesFor(
  results: ReturnType<typeof run>,
  mode: "swing" | "etrade",
): SimTrade[] {
  return results.find((result) => result.mode === mode)?.trades ?? [];
}

function stateFor(
  results: ReturnType<typeof run>,
  mode: "swing" | "etrade",
): SimPortfolioState {
  const result = results.find((item) => item.mode === mode);
  if (result === undefined) {
    throw new Error(`missing result for ${mode}`);
  }
  return result.state;
}

describe("runSimulatorTick", () => {
  it("starts each mode with 5 000 kr and no position", () => {
    const state = emptyPortfolioState();

    expect(SIM_STARTING_CASH).toBe(5_000);
    expect(state).toEqual({
      cash: 5_000,
      position: null,
      pending: null,
    });
  });

  it("buys the swing report's main candidate and charges the buy fee", () => {
    const results = run({}, makeSnapshot([makeStock()]));
    const state = stateFor(results, "swing");
    const trades = tradesFor(results, "swing");

    expect(trades).toHaveLength(1);
    expect(trades[0].side).toBe("buy");
    expect(trades[0].ticker).toBe("TEST");
    expect(trades[0].fee).toBe(29);
    expect(trades[0].reason).toContain("Swing: TEST");
    expect(state.position?.ticker).toBe("TEST");
    expect(state.cash).toBeLessThan(5_000);
    expect(results.find((item) => item.mode === "swing")?.equity.equity).toBe(
      state.cash + (state.position?.shares ?? 0) * 100,
    );
  });

  it("never owns more than one stock per mode", () => {
    const snapshot = makeSnapshot([makeStock()]);
    const first = run({}, snapshot);
    const second = run({ swing: stateFor(first, "swing") }, snapshot);

    expect(tradesFor(second, "swing")).toHaveLength(0);
    expect(stateFor(second, "swing").position?.ticker).toBe("TEST");
  });

  it("sells a swing position at the stop and records the loss", () => {
    const results = run(
      { swing: seedPosition({ ticker: "HOLD" }) },
      makeSnapshot([passiveStock({ close: 94 })]),
    );
    const state = stateFor(results, "swing");
    const [sell] = tradesFor(results, "swing");

    expect(state.position).toBeNull();
    expect(sell.side).toBe("sell");
    expect(sell.reason).toBe("Stop");
    expect(sell.quantity).toBe(40);
    expect(sell.realizedPnl).toBeLessThan(0);
    expect(sell.realizedPnl).toBeCloseTo(40 * (94 - 100) - 29 - 29, 2);
  });

  it("sells a swing position at the target", () => {
    const results = run(
      { swing: seedPosition({ ticker: "HOLD", targetPrice: 110 }) },
      makeSnapshot([passiveStock({ close: 111 })]),
    );
    const [sell] = tradesFor(results, "swing");

    expect(stateFor(results, "swing").position).toBeNull();
    expect(sell.reason).toBe("Mål");
    expect(sell.realizedPnl).toBeGreaterThan(0);
    expect(sell.realizedPnl).toBeCloseTo(40 * (111 - 100) - 29 - 29, 2);
  });

  it("ratchets the swing stop upwards as the price rises", () => {
    const results = run(
      {
        swing: seedPosition({
          ticker: "HOLD",
          highestPrice: 120,
          stopPrice: 100,
        }),
      },
      makeSnapshot([passiveStock({ close: 113 })]),
    );
    const [sell] = tradesFor(results, "swing");

    expect(sell.reason).toBe("Stop");
    expect(sell.price).toBe(113);
    expect(stateFor(results, "swing").position).toBeNull();
  });

  it("sells a swing position at the time stop after five trading days", () => {
    const results = run(
      {
        swing: seedPosition({
          ticker: "HOLD",
          entryAt: "2026-10-26T09:30:00.000Z",
          highestPrice: 104,
          stopPrice: 95,
        }),
      },
      makeSnapshot([passiveStock({ close: 104 })]),
    );
    const [sell] = tradesFor(results, "swing");

    expect(sell.reason).toBe("Tidsstopp");
    expect(stateFor(results, "swing").position).toBeNull();
  });

  it("holds a swing position over the weekend", () => {
    const friday = new Date("2026-11-06T15:45:00+01:00");
    const results = run(
      { swing: seedPosition({ ticker: "HOLD" }) },
      makeSnapshot([passiveStock({ close: 101 })], friday),
      friday,
    );

    expect(tradesFor(results, "swing")).toHaveLength(0);
    expect(stateFor(results, "swing").position).not.toBeNull();
  });

  it("can open a swing position on Friday afternoon", () => {
    const friday = new Date("2026-11-06T15:30:00+01:00");
    const results = run({}, makeSnapshot([makeStock()], friday), friday);

    expect(tradesFor(results, "swing")).toHaveLength(1);
    expect(stateFor(results, "swing").position?.ticker).toBe("TEST");
  });

  it("waits for an Etrade trigger and buys when it is crossed", () => {
    const nearHigh = { high52w: 100.4, ath: 100.4, high: 100.2 };
    const snapshot = makeSnapshot([makeStock(nearHigh)]);
    const first = run({}, snapshot);
    const pending = stateFor(first, "etrade");

    expect(tradesFor(first, "etrade")).toHaveLength(0);
    expect(pending.pending?.ticker).toBe("TEST");
    expect(pending.pending?.trigger).toBeGreaterThan(100);

    const second = run(
      { etrade: pending },
      makeSnapshot([makeStock({ ...nearHigh, close: 102, high: 103 })]),
    );
    const [buy] = tradesFor(second, "etrade");

    expect(buy.side).toBe("buy");
    expect(buy.reason).toContain("trigger");
    expect(stateFor(second, "etrade").position?.ticker).toBe("TEST");
  });

  it("drops an Etrade trigger that falls through invalidation", () => {
    const nearHigh = { high52w: 100.4, ath: 100.4, high: 100.2 };
    const first = run({}, makeSnapshot([makeStock(nearHigh)]));
    const pending = stateFor(first, "etrade");
    const second = run(
      { etrade: pending },
      makeSnapshot([makeStock({ ...nearHigh, close: 99, low: 98 })]),
    );

    expect(tradesFor(second, "etrade")).toHaveLength(0);
    expect(stateFor(second, "etrade").pending).toBeNull();
    expect(stateFor(second, "etrade").position).toBeNull();
  });

  it("takes Etrade profits in three partial exits and protects the entry", () => {
    const targets: SimTarget[] = [
      { label: "T1", price: 105 },
      { label: "T2", price: 110 },
      { label: "T3", price: 120 },
    ];
    const base = seedPosition({ ticker: "HOLD", targets });
    const t1 = run(
      { etrade: base },
      makeSnapshot([passiveStock({ close: 106 })]),
    );
    const t1State = stateFor(t1, "etrade");
    const t1Trade = tradesFor(t1, "etrade")[0];

    expect(t1Trade.reason).toBe("T1");
    expect(t1Trade.quantity).toBe(20);
    expect(t1State.position?.shares).toBe(20);
    expect(t1State.position?.stage).toBe(1);
    expect(t1State.position?.stopPrice).toBe(100);

    const t2 = run(
      { etrade: t1State },
      makeSnapshot([passiveStock({ close: 111 })]),
    );
    const t2State = stateFor(t2, "etrade");
    const t2Trade = tradesFor(t2, "etrade")[0];

    expect(t2Trade.reason).toBe("T2");
    expect(t2Trade.quantity).toBe(10);
    expect(t2State.position?.shares).toBe(10);
    expect(t2State.position?.stage).toBe(2);

    const t3 = run(
      { etrade: t2State },
      makeSnapshot([passiveStock({ close: 121 })]),
    );

    expect(tradesFor(t3, "etrade")[0].reason).toBe("T3");
    expect(tradesFor(t3, "etrade")[0].quantity).toBe(10);
    expect(stateFor(t3, "etrade").position).toBeNull();
  });

  it("applies the Etrade time stop after three trading days", () => {
    const results = run(
      {
        etrade: seedPosition({
          ticker: "HOLD",
          entryAt: "2026-10-30T09:30:00.000Z",
          highestPrice: 104,
          stopPrice: 95,
          targets: [
            { label: "T1", price: 120 },
            { label: "T2", price: 130 },
            { label: "T3", price: 140 },
          ],
          maxHoldingDays: 3,
        }),
      },
      makeSnapshot([passiveStock({ close: 104 })]),
    );

    expect(tradesFor(results, "etrade")[0].reason).toBe("Tidsstopp");
    expect(stateFor(results, "etrade").position).toBeNull();
  });

  it("holds an Etrade position over the weekend", () => {
    const friday = new Date("2026-11-06T15:45:00+01:00");
    const results = run(
      {
        etrade: seedPosition({
          ticker: "HOLD",
          entryAt: "2026-11-05T09:30:00.000Z",
          stopPrice: 95,
          targets: [
            { label: "T1", price: 120 },
            { label: "T2", price: 130 },
            { label: "T3", price: 140 },
          ],
          maxHoldingDays: 3,
        }),
      },
      makeSnapshot([passiveStock({ close: 104 })], friday),
      friday,
    );

    expect(tradesFor(results, "etrade")).toHaveLength(0);
    expect(stateFor(results, "etrade").position).not.toBeNull();
  });

  it("can create an Etrade trigger on Friday afternoon", () => {
    const friday = new Date("2026-11-06T15:30:00+01:00");
    const nearHigh = { high52w: 100.4, ath: 100.4, high: 100.2 };
    const results = run(
      {},
      makeSnapshot([makeStock(nearHigh)], friday),
      friday,
    );

    expect(tradesFor(results, "etrade")).toHaveLength(0);
    expect(stateFor(results, "etrade").pending?.ticker).toBe("TEST");
  });
});
