import { describe, expect, it } from "vitest";
import type { Stock } from "./types";
import { findTrendlineSetups } from "./trendline";

const risingLows = [
  90, 91, 92, 93, 94, 90, 92, 94, 95, 96,
  91, 93, 95, 97, 98, 92, 94, 96, 99, 100,
];
const historyPrefix = Array.from({ length: 106 }, (_, index) => 68 + index * 0.2);
const sixMonthHistory = [...historyPrefix, ...risingLows];
const highPrefix = Array.from({ length: 105 }, (_, index) => 95 + index * 0.2);
const risingHighs = [
  100, 101, 102, 103, 110, 104, 105, 106, 107, 112, 108,
  109, 110, 111, 115, 112, 113, 114, 116, 118, 117,
];
const sixMonthHighs = [...highPrefix, ...risingHighs];
const eloMonthlyLows = [
  33.75, 33, 33, 34.9, 34.1, 34.05, 34.05, 33.7, 34.05, 34.5,
  35.3, 34.5, 34.7, 35.2, 36.1, 36.35, 36.6, 36.85, 36.8, 36.45, 36.45,
];

function makeStock(overrides: Partial<Stock> = {}): Stock {
  return {
    ticker: "TEST",
    name: "Test ASA",
    close: 94,
    currency: "NOK",
    weekReturn: -0.04,
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
    low: null,
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
    expect(setups.map((item) => item.lookbackMonths)).toContain(1);
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

  it("does not call a rising-price setup approaching from above", () => {
    expect(findTrendlineSetups([makeStock({ weekReturn: 0.04 })])).toEqual([]);
  });

  it("does not re-anchor a 6-month uptrend after the latest pivot made a lower low", () => {
    const brokenRecentStructure = [...risingLows];
    brokenRecentStructure[15] = 89;
    const setup = findTrendlineSetups([
      makeStock({ recentLows: [...historyPrefix, ...brokenRecentStructure] }),
    ]);

    expect(setup).toEqual([]);
  });

  it("separates a price resting on the line from one that just bounced", () => {
    const base = findTrendlineSetups([makeStock()]).find(
      (item) => item.lookbackMonths === 3,
    );
    expect(base).toBeDefined();
    const atLine = findTrendlineSetups([
      makeStock({
        close: base!.supportPrice * 1.005,
        low: base!.supportPrice * 1.001,
      }),
    ]).find((item) => item.lookbackMonths === 3);
    const bounced = findTrendlineSetups([
      makeStock({
        close: base!.supportPrice * 1.03,
        low: base!.supportPrice * 1.001,
      }),
    ]).find((item) => item.lookbackMonths === 3);

    expect(atLine?.phase).toBe("on_line");
    expect(bounced?.phase).toBe("bounced");
  });

  it("keeps a weaker short-span trendline as a candidate", () => {
    const setup = findTrendlineSetups([
      makeStock({
        close: 100,
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

  it("detects ELO-style month-long support and a recent bounce at the window edge", () => {
    const setup = findTrendlineSetups([
      makeStock({
        ticker: "ELO",
        name: "Elopak ASA",
        close: 37.6,
        atr: 0.8746,
        averageVolume10d: 238_190,
        recentLows: eloMonthlyLows,
        low: 37.35,
      }),
    ]).find((item) => item.lookbackMonths === 1);

    expect(setup).toBeDefined();
    expect(setup?.phase).toBe("bounced");
    expect(setup?.supportPrice).toBeGreaterThan(36);
    expect(setup?.supportPrice).toBeLessThan(37.5);
  });

  it("estimates a channel target only when recent swing highs are rising", () => {
    const setup = findTrendlineSetups([
      makeStock({ recentHighs: sixMonthHighs }),
    ]).find((item) => item.lookbackMonths === 1);

    expect(setup?.higherHighs).toBe(true);
    expect(setup?.channelWidth).toBeGreaterThan(0);
    expect(setup?.channelTarget).toBeGreaterThan(setup!.stock.close);
    expect(setup?.completedTopCycles).toBeGreaterThanOrEqual(2);
    expect(setup?.averageSessionsToSwingHigh).toBeGreaterThan(0);
  });

  it("does not manufacture a channel target when high history is missing", () => {
    const setup = findTrendlineSetups([makeStock()]).find(
      (item) => item.lookbackMonths === 1,
    );

    expect(setup?.higherHighs).toBeNull();
    expect(setup?.channelWidth).toBeNull();
    expect(setup?.channelTarget).toBeNull();
  });

  it("does not label short history as a 3- or 6-month setup", () => {
    expect(findTrendlineSetups([makeStock({ recentLows: risingLows })])).toEqual([]);
  });
});
