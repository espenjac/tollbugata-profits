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
    benchmark: {
      ticker: "OSEBX",
      name: "Oslo Børs Benchmark GI Index",
      value: 2053.36,
      changePct: -1.25,
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
    expect(snapshot.benchmark?.ticker).toBe("OSEBX");
    expect(snapshot.benchmark?.value).toBe(2053.36);
    expect(snapshot.benchmark?.changePct).toBe(-1.25);
    expect(snapshot.benchmark?.source).toBe("live");
    expect(snapshot.generatedAt.toISOString()).toBe(
      new Date("2026-11-01T14:07:00+01:00").toISOString(),
    );
  });

  it("ignores a missing or invalid benchmark without failing the snapshot", () => {
    const missing = rawSnapshot();
    delete missing.benchmark;
    expect(parseMarketSnapshot(missing).benchmark).toBeNull();

    const invalid = rawSnapshot();
    invalid.benchmark = { value: null, source: "error" };
    expect(parseMarketSnapshot(invalid).benchmark).toBeNull();

    const zero = rawSnapshot();
    zero.benchmark = { value: 0, source: "live" };
    expect(parseMarketSnapshot(zero).benchmark).toBeNull();
  });

  it("attaches cached daily lows from the history source to normalized stocks", () => {
    const raw = rawSnapshot();
    raw.trendlineHistory = {
      lowsByTicker: { EQNR: Array.from({ length: 126 }, (_, index) => 400 + index) },
      datesByTicker: {
        EQNR: Array.from({ length: 126 }, (_, index) =>
          new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
        ),
      },
      source: "live",
      warning: "Noen historiske kurser mangler.",
    };

    const snapshot = parseMarketSnapshot(raw);
    const equinor = snapshot.universe.stocks.find((stock) => stock.ticker === "EQNR");

    expect(equinor?.recentLows).toHaveLength(126);
    expect(equinor?.recentLows?.[0]).toBe(400);
    expect(equinor?.recentLowDates?.[0]).toBe("2026-01-01");
    expect(snapshot.trendlineHistoryWarning).toContain("Noen historiske kurser");
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
