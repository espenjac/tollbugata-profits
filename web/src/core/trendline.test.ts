import { describe, expect, it } from "vitest";
import type { Stock } from "./types";
import { findTrendlineSetups } from "./trendline";

const risingLows = [
  90, 91, 92, 93, 94, 90, 92, 94, 95, 96,
  91, 93, 95, 97, 98, 92, 94, 96, 99, 100,
];
const historyPrefix = Array.from({ length: 106 }, (_, index) => 68 + index * 0.2);
const sixMonthHistory = [...historyPrefix, ...risingLows];

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
    recentLows: sixMonthHistory,
    ...overrides,
  };
}

describe("findTrendlineSetups", () => {
  it("finds rising 3- and 6-month support-line setups", () => {
    const setups = findTrendlineSetups([makeStock()]);
    const setup = setups.find((item) => item.lookbackMonths === 3);

    expect(setup?.stock.ticker).toBe("TEST");
    expect(setups.map((item) => item.lookbackMonths)).toContain(6);
    expect(setup?.phase).toBe("approaching");
    expect(setup?.touches).toBeGreaterThanOrEqual(2);
    expect(setup?.lineRisePct).toBeGreaterThan(0);
    expect(setup?.distancePct).toBeGreaterThan(0);
    expect(setup?.distancePct).toBeLessThan(0.05);
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
    const base = findTrendlineSetups([makeStock()]).find(
      (item) => item.lookbackMonths === 3,
    );
    expect(base).toBeDefined();
    const atLine = findTrendlineSetups([
      makeStock({
        close: base!.supportPrice * 1.005,
        low: base!.supportPrice * 0.99,
      }),
    ]).find((item) => item.lookbackMonths === 3);
    const bounced = findTrendlineSetups([
      makeStock({
        close: base!.supportPrice * 1.03,
        low: base!.supportPrice * 0.99,
      }),
    ]).find((item) => item.lookbackMonths === 3);

    expect(atLine?.phase).toBe("on_line");
    expect(bounced?.phase).toBe("bounced");
  });

  it("keeps a weaker short-span trendline as a candidate", () => {
    const setup = findTrendlineSetups([
      makeStock({
        recentLows: [
          ...historyPrefix,
          93, 94, 95, 94, 92, 94, 95, 96, 95, 93,
          94, 95, 96, 97, 98, 99, 100, 101, 102, 103,
        ],
      }),
    ]).find((item) => item.lookbackMonths === 3);

    expect(setup?.anchorGap).toBeLessThan(8);
    expect(setup?.quality).toBe("weaker");
  });

  it("does not label short history as a 3- or 6-month setup", () => {
    expect(findTrendlineSetups([makeStock({ recentLows: risingLows })])).toEqual([]);
  });
});
