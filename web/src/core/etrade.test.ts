import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "./config";
import { buildEtradeReport } from "./etrade";
import type { Stock, Universe } from "./types";

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

function makeUniverse(stocks: Stock[]): Universe {
  return {
    stocks,
    fetchedAt: new Date("2026-11-05T10:00:00+01:00"),
    source: "live",
    warning: null,
    growthTickers: new Set(),
    growthSource: "live",
    growthWarning: null,
  };
}

function makeReport(
  stocks: Stock[],
  settings: Settings = DEFAULT_SETTINGS,
  now = new Date("2026-11-05T10:00:00+01:00"),
) {
  return buildEtradeReport(
    stocks,
    makeUniverse(stocks),
    null,
    settings,
    "2026-11-05",
    now,
  );
}

describe("buildEtradeReport", () => {
  it("builds a breakout idea with trigger, stop and three targets", () => {
    const report = makeReport([makeStock()]);

    expect(report.ideas).toHaveLength(1);
    expect(report.watchlist).toHaveLength(0);
    const idea = report.ideas[0];

    expect(idea.setup).toBe("breakout");
    expect(idea.trigger).toBeCloseTo(101 * 1.003);
    expect(idea.stopPct).toBeCloseTo(0.03);
    expect(idea.stopPrice).toBeLessThan(idea.trigger);
    expect(idea.targets).toHaveLength(3);
    expect(idea.targets[0].price).toBeGreaterThan(idea.trigger);
    expect(idea.targets[1].price).toBeGreaterThan(idea.targets[0].price);
    expect(idea.targets[2].price).toBeGreaterThan(idea.targets[1].price);
    expect(idea.targets[0].pct).toBeGreaterThan(0.05);
    expect(idea.rewardRisk).not.toBeNull();
    expect(idea.rewardRisk!).toBeGreaterThan(1);
    expect(idea.blockReasons).toEqual([]);
    expect(idea.checks.every((check) => check.ok)).toBe(true);
    expect(idea.shares).toBeGreaterThan(0);
    expect(idea.horizonDays).toBe(3);
  });

  it("clamps the stop to 3-5 % and falls back to 4 % without ATR", () => {
    const low = makeReport([makeStock({ ticker: "LOW", atr: 0.5 })]).ideas[0];
    const high = makeReport([makeStock({ ticker: "HIGH", atr: 10 })]).ideas[0];
    const missing = makeReport([
      makeStock({ ticker: "NOATR", atr: null }),
    ]).ideas[0];

    expect(low.stopPct).toBeCloseTo(0.03);
    expect(high.stopPct).toBeCloseTo(0.05);
    expect(missing.stopPct).toBeCloseTo(0.04);
    expect(missing.warnings.join(" ")).toContain("ATR mangler");
  });

  it("moves overheated ideas to the watchlist instead of recommending them", () => {
    const report = makeReport([makeStock({ rsi: 80 })]);

    expect(report.ideas).toHaveLength(0);
    expect(report.watchlist).toHaveLength(1);
    expect(report.watchlist[0].blockReasons.join(" ")).toContain("RSI over 75");
    expect(report.noIdeaReason).toContain("TEST");
    expect(report.noIdeaReason).toContain("RSI over 75");
  });

  it("drops ideas that cannot buy one whole share after fees", () => {
    const expensive = makeStock({ close: 100, high: 101, atr: 3 });
    const report = makeReport([expensive], {
      ...DEFAULT_SETTINGS,
      trade: {
        ...DEFAULT_SETTINGS.trade,
        capital: 100,
      },
    });

    expect(report.ideas).toHaveLength(0);
    expect(report.watchlist).toHaveLength(0);
    expect(report.noIdeaReason).toContain("Ingen aksjer passerte");
  });

  it("uses time-weighted volume so a liquid stock is not blocked at the open", () => {
    const stock = makeStock({
      volume: 80_000,
      averageVolume10d: 800_000,
    });
    const morning = new Date("2026-11-05T09:30:00+01:00");
    const early = makeReport([stock], DEFAULT_SETTINGS, morning);
    const midday = makeReport(
      [stock],
      DEFAULT_SETTINGS,
      new Date("2026-11-05T12:00:00+01:00"),
    );

    expect(early.ideas).toHaveLength(1);
    expect(early.ideas[0].volumePace).toBeCloseTo(0.1 / 0.13, 2);
    expect(early.ideas[0].blockReasons).toEqual([]);

    expect(midday.ideas).toHaveLength(0);
    expect(midday.watchlist[0].blockReasons.join(" ")).toContain(
      "under forventet",
    );
  });

  it("orders ideas by Etrade score", () => {
    const strong = makeStock({
      ticker: "STRONG",
      weekReturn: 0.12,
      monthReturn: 0.2,
      volume: 2_000_000,
      averageVolume10d: 800_000,
      dayReturn: 0.01,
    });
    const weaker = makeStock({
      ticker: "WEAKER",
      weekReturn: 0.01,
      monthReturn: 0.02,
      volume: 600_000,
      averageVolume10d: 800_000,
      dayReturn: 0.005,
    });
    const report = makeReport([weaker, strong]);

    expect(report.ideas).toHaveLength(2);
    expect(report.ideas[0].score).toBeGreaterThanOrEqual(report.ideas[1].score);
    expect(report.ideas[0].candidate.stock.ticker).toBe("STRONG");
  });
});
