import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./config";
import { parseNewsPayload } from "./news";
import { parseScannerPayload } from "./market";
import { DEFAULT_CRITERIA, screen } from "./screen";
import { buildMarketReport } from "./report";
import type { Universe } from "./types";
import scanFixture from "./__fixtures__/scan.json";
import newsFixture from "./__fixtures__/news.json";
import growthFixture from "./__fixtures__/growth.json";
import expected from "./__fixtures__/premarket.json";

function loadUniverse(): Universe {
  const growthTickers = new Set<string>(growthFixture.tickers as string[]);
  const stocks = parseScannerPayload(scanFixture, growthTickers);
  return {
    stocks,
    fetchedAt: new Date(expected.universe_fetched_at),
    source: "live",
    warning: null,
    growthTickers,
    growthSource: "live",
    growthWarning: null,
  };
}

function loadNews() {
  return parseNewsPayload(
    newsFixture,
    new Date(expected.news_since ?? "2026-10-30T16:30:00+01:00"),
    new Date("2026-11-01T14:07:00+01:00"),
    "live",
  );
}

describe("ported core parity with the Python implementation", () => {
  it("screens the same fixture and keeps the same exclusions", () => {
    const universe = loadUniverse();
    const result = screen(universe.stocks, DEFAULT_CRITERIA);
    expect(result.universeSize).toBe(290);
    expect(result.matches).toHaveLength(68);
    expect(result.atHighCount).toBe(2);
    expect(result.excluded).toMatchObject({
      "under SMA5": 44,
      "svak uke": 93,
      "euronext growth": 85,
    });
  });

  it("builds the same ranked report from the same snapshot", () => {
    const universe = loadUniverse();
    const result = screen(universe.stocks, DEFAULT_CRITERIA);
    const news = loadNews();
    const report = buildMarketReport(
      result.matches,
      DEFAULT_CRITERIA,
      universe,
      news,
      DEFAULT_SETTINGS,
      "2026-11-01",
      new Date("2026-11-01T14:07:00+01:00"),
    );

    expect(report.main?.candidate.stock.ticker).toBe(expected.main?.ticker);
    expect(report.main?.candidate.score).toBeCloseTo(expected.main?.score ?? 0, 1);
    expect(report.main?.candidate.opportunityScore).toBeCloseTo(
      expected.main?.opportunity_score ?? 0,
      1,
    );
    expect(report.main?.candidate.riskScore).toBeCloseTo(
      expected.main?.risk_score ?? 0,
      1,
    );
    expect(report.ranked.map((item) => item.candidate.stock.ticker)).toEqual(
      expected.top_candidates.map((item) => item.ticker),
    );
    expect(report.blocked.map((item) => item.candidate.stock.ticker)).toEqual(
      expected.blocked.map((item) => item.ticker),
    );
    expect(report.noTradeReason).toBe(expected.no_trade_reason);
  });
});
