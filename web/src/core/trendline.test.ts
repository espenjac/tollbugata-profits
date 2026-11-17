import { describe, expect, it } from "vitest";
import type { Stock } from "./types";
import { findTrendlineSetups } from "./trendline";

const risingLows = [
  90, 91, 92, 93, 94, 90, 92, 94, 95, 96,
  91, 93, 95, 97, 98, 92, 94, 96, 99, 100,
];

function makeStock(overrides: Partial<Stock> = {}): Stock {
  return {
    ticker: "TEST",
    name: "Test ASA",
    close: 94,
    currency: "NOK",
    weekReturn: 0.04,
    monthReturn: 0.1,
    quarterReturn: 0.18,
    sma5: 94,
    sma20: 92,
    sma50: 89,
    rsi: 55,
    ath: 110,
    high52w: 110,
    marketCap: 2_000_000_000,
    volume: 120_000,
    sector: "Industry",
    instrumentType: "stock",
    market: "oslo",
    earningsDate: null,
    exDividendDate: null,
    averageVolume10d: 100_000,
    atr: 3,
    dayReturn: 0.01,
    open: 93,
    high: 95,
    previousDayHigh: 94,
    low: 91.5,
    vwap: 94,
    recentLows: risingLows,
    ...overrides,
  };
}

describe("findTrendlineSetups", () => {
  it("finds a volatile stock close to a rising month-long support line", () => {
    const [setup] = findTrendlineSetups([makeStock()]);

    expect(setup.stock.ticker).toBe("TEST");
    expect(setup.phase).toBe("approaching");
    expect(setup.touches).toBeGreaterThanOrEqual(2);
    expect(setup.lineRisePct).toBeGreaterThan(0);
    expect(setup.distancePct).toBeGreaterThan(0);
    expect(setup.distancePct).toBeLessThan(0.05);
  });

  it("ignores stocks without enough volatility, liquidity, or history", () => {
    expect(findTrendlineSetups([
      makeStock({ atr: 1 }),
      makeStock({ averageVolume10d: 10_000 }),
      makeStock({ recentLows: undefined }),
    ])).toEqual([]);
  });

  it("does not include a stock whose price has fallen well below its line", () => {
    expect(findTrendlineSetups([makeStock({ close: 85 })])).toEqual([]);
  });

  it("separates a price resting on the line from one that just bounced", () => {
    const [base] = findTrendlineSetups([makeStock()]);
    const atLine = findTrendlineSetups([
      makeStock({
        close: base.supportPrice * 1.005,
        low: base.supportPrice * 0.99,
      }),
    ]);
    const bounced = findTrendlineSetups([
      makeStock({
        close: base.supportPrice * 1.03,
        low: base.supportPrice * 0.99,
      }),
    ]);

    expect(atLine[0]?.phase).toBe("on_line");
    expect(bounced[0]?.phase).toBe("bounced");
  });
});
