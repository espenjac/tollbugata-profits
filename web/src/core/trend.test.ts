import { describe, expect, it } from "vitest";
import { buildTrendIdeas } from "./trend";
import type { Stock } from "./types";

function makeStock(overrides: Partial<Stock> = {}): Stock {
  return {
    ticker: "TEST",
    name: "Test ASA",
    close: 100,
    currency: "NOK",
    weekReturn: 0.05,
    monthReturn: 0.12,
    quarterReturn: 0.25,
    sma5: 99,
    sma20: 96,
    sma50: 90,
    rsi: 60,
    ath: 120,
    high52w: 120,
    marketCap: 1_000_000_000,
    volume: 1_000_000,
    sector: "Industri",
    instrumentType: "stock",
    market: "oslo",
    earningsDate: null,
    exDividendDate: null,
    averageVolume10d: 800_000,
    atr: 3,
    dayReturn: 0.01,
    open: 99,
    high: 101,
    previousDayHigh: 100.2,
    low: 98,
    vwap: 100,
    ...overrides,
  };
}

describe("buildTrendIdeas", () => {
  it("requires a strong higher-timeframe trend and anchors entry to prior high", () => {
    const [idea] = buildTrendIdeas([makeStock()], 5_000, 29);

    expect(idea.stock.ticker).toBe("TEST");
    expect(idea.trigger).toBeCloseTo(100.2 * 1.003);
    expect(idea.invalidation).toBeCloseTo(96 * 0.99);
    expect(idea.entry).toBe(idea.trigger);
    expect(idea.stopPct).toBeCloseTo(0.06);
    expect(idea.stopPrice).toBeCloseTo(idea.entry * 0.94);
    expect(idea.shares).toBe(49);
  });

  it("rejects weak, overextended, illiquid and Euronext Growth stocks", () => {
    const ideas = buildTrendIdeas(
      [
        makeStock({ ticker: "WEAK", sma20: 89 }),
        makeStock({ ticker: "EXTENDED", close: 108, previousDayHigh: 100.2 }),
        makeStock({ ticker: "ILLIQUID", averageVolume10d: 10_000 }),
        makeStock({ ticker: "GROWTH", market: "euronext_growth" }),
      ],
      5_000,
      29,
    );

    expect(ideas).toEqual([]);
  });

  it("ranks the stronger medium-term trend first", () => {
    const ideas = buildTrendIdeas(
      [
        makeStock({ ticker: "SLOW", monthReturn: 0.04, quarterReturn: 0.08 }),
        makeStock({ ticker: "STRONG", monthReturn: 0.18, quarterReturn: 0.35 }),
      ],
      5_000,
      29,
    );

    expect(ideas.map((idea) => idea.stock.ticker)).toEqual([
      "STRONG",
      "SLOW",
    ]);
  });
});
