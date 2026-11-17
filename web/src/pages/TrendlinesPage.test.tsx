// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../core/snapshot";
import type { Stock } from "../core/types";
import { TrendlinesPage } from "./TrendlinesPage";

const mockState = vi.hoisted(() => ({
  snapshot: null as unknown,
}));

vi.mock("../lib/useTrendlines", () => ({
  useTrendlines: () => ({
    snapshot: mockState.snapshot,
    loading: false,
    refreshing: false,
    error: null,
    refresh: async () => {},
  }),
}));

const recentLows = [
  90, 91, 92, 93, 94, 90, 92, 94, 95, 96,
  91, 93, 95, 97, 98, 92, 94, 96, 99, 100,
];

function makeStock(): Stock {
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
    low: 92,
    vwap: 94,
    recentLows,
  };
}

function snapshot(stocks: Stock[]): MarketSnapshot {
  const now = new Date("2026-11-05T10:00:00+01:00");
  return {
    universe: {
      stocks,
      fetchedAt: now,
      source: "live",
      warning: null,
      growthTickers: new Set(),
      growthSource: "live",
      growthWarning: null,
    },
    news: {
      itemsByTicker: new Map(),
      itemsByName: new Map(),
      fetchedAt: now,
      since: now,
      source: "live",
      warning: null,
      sessionOpen: null,
    },
    benchmark: null,
    generatedAt: now,
  };
}

describe("TrendlinesPage", () => {
  it("shows trendline candidates and volatility details", () => {
    mockState.snapshot = snapshot([makeStock()]);
    const { container } = render(<TrendlinesPage />);
    const text = container.textContent ?? "";

    expect(text).toContain("Trendlinjer");
    expect(text).toContain("Nær stigende trendlinje (1)");
    expect(text).toContain("TEST");
    expect(text).toContain("ATR/dag");
    expect(text).toContain("10,0 %");
  });

  it("explains when the market snapshot has no historical lows", () => {
    mockState.snapshot = snapshot([{ ...makeStock(), recentLows: undefined }]);
    const { container } = render(<TrendlinesPage />);
    const text = container.textContent ?? "";

    expect(text).toContain("Historiske dagsbunner mangler");
    expect(text).toContain("Mangler historikk");
  });
});
