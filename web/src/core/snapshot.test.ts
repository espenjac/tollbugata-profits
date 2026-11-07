import { describe, expect, it } from "vitest";
import { parseMarketSnapshot, type RawSnapshot } from "./snapshot";
import scanFixture from "./__fixtures__/scan.json";
import newsFixture from "./__fixtures__/news.json";
import growthFixture from "./__fixtures__/growth.json";
import expected from "./__fixtures__/premarket.json";

function rawSnapshot(): RawSnapshot {
  return {
    generatedAt: "2026-11-01T14:07:00+01:00",
    scan: {
      payload: scanFixture,
      fetchedAt: "2026-11-01T14:07:00+01:00",
      source: "live",
      warning: null,
    },
    growth: {
      tickers: growthFixture.tickers as string[],
      fetchedAt: "2026-11-01T14:00:00+01:00",
      source: "cache",
      warning: null,
    },
    news: {
      payload: newsFixture,
      since: expected.news_since ?? "2026-10-30T16:30:00+01:00",
      fetchedAt: "2026-11-01T14:07:00+01:00",
      source: "live",
      warning: null,
    },
  };
}

describe("parseMarketSnapshot", () => {
  it("parses the scanner, growth list and news from a raw response", () => {
    const snapshot = parseMarketSnapshot(rawSnapshot());

    expect(snapshot.universe.stocks).toHaveLength(290);
    expect(snapshot.universe.source).toBe("live");
    expect(snapshot.universe.growthTickers.size).toBe(
      growthFixture.tickers.length,
    );
    expect(snapshot.universe.growthSource).toBe("cache");
    expect(snapshot.news.source).toBe("live");
    expect(snapshot.news.itemsByTicker.size).toBeGreaterThan(0);
    expect(snapshot.generatedAt.toISOString()).toBe(
      new Date("2026-11-01T14:07:00+01:00").toISOString(),
    );
  });

  it("falls back to an empty news feed when NewsWeb is unusable", () => {
    const raw = rawSnapshot();
    raw.news = { payload: {}, source: "error", warning: "NewsWeb nede" };

    const snapshot = parseMarketSnapshot(raw);

    expect(snapshot.news.source).toBe("error");
    expect(snapshot.news.warning).toContain("NewsWeb nede");
    expect(snapshot.universe.stocks).toHaveLength(290);
  });

  it("throws when the scanner payload is missing", () => {
    expect(() =>
      parseMarketSnapshot({
        error: "TradingView svarte ikke",
      }),
    ).toThrow("TradingView svarte ikke");

    expect(() => parseMarketSnapshot({})).toThrow(
      "Markedssvaret manglet TradingView-data.",
    );
  });
});
