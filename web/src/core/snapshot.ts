import { parseScannerPayload } from "./market";
import { emptyNewsFeed, parseNewsPayload, type NewsFeed } from "./news";
import type { Universe } from "./types";

/**
 * Raw response from the `market-snapshot` Edge Function. The function returns
 * the upstream payloads without normalizing them, so the same parser is used by
 * the PWA and by the simulator tick.
 */
export interface RawSnapshotSource<T> {
  payload?: T;
  tickers?: string[];
  since?: string;
  fetchedAt?: string;
  warning?: string | null;
  source?: string;
}

export interface RawSnapshot {
  generatedAt?: string;
  scan?: RawSnapshotSource<unknown>;
  growth?: RawSnapshotSource<unknown>;
  news?: RawSnapshotSource<unknown>;
  benchmark?: RawBenchmark;
  error?: string;
}

export interface RawBenchmark {
  ticker?: string;
  name?: string;
  value?: number | null;
  changePct?: number | null;
  fetchedAt?: string;
  source?: string;
  warning?: string | null;
}

export interface MarketBenchmark {
  ticker: string;
  name: string;
  value: number;
  changePct: number | null;
  fetchedAt: Date;
  source: "live" | "cache" | "stale-cache" | "error";
  warning: string | null;
}

export interface MarketSnapshot {
  universe: Universe;
  news: NewsFeed;
  benchmark: MarketBenchmark | null;
  generatedAt: Date;
}

function sourceValue(
  value: string | undefined,
): "live" | "cache" | "stale-cache" {
  if (value === "cache" || value === "stale-cache") {
    return value;
  }
  return "live";
}

function newsSourceValue(
  value: string | undefined,
): "live" | "cache" | "stale-cache" | "error" {
  if (value === "cache" || value === "stale-cache" || value === "error") {
    return value;
  }
  return "live";
}

function parseBenchmark(
  data: RawBenchmark | undefined,
  now: Date,
): MarketBenchmark | null {
  if (
    !data ||
    data.value === null ||
    data.value === undefined ||
    !Number.isFinite(data.value) ||
    data.value <= 0
  ) {
    return null;
  }
  return {
    ticker:
      typeof data.ticker === "string" && data.ticker.trim()
        ? data.ticker.trim()
        : "OSEBX",
    name:
      typeof data.name === "string" && data.name.trim()
        ? data.name.trim()
        : "Oslo Børs Benchmark GI Index",
    value: data.value,
    changePct:
      typeof data.changePct === "number" && Number.isFinite(data.changePct)
        ? data.changePct
        : null,
    fetchedAt: data.fetchedAt ? new Date(data.fetchedAt) : now,
    source: newsSourceValue(data.source),
    warning: data.warning ?? null,
  };
}

/**
 * Converts the raw Edge Function response into the normalized snapshot used by
 * the report generators. Throws when the scanner payload is missing or empty.
 */
export function parseMarketSnapshot(
  data: RawSnapshot,
  now: Date = new Date(),
): MarketSnapshot {
  if (!data || data.error) {
    throw new Error(data?.error ?? "Markedsfunksjonen svarte uten data.");
  }
  if (!data.scan?.payload) {
    throw new Error("Markedssvaret manglet TradingView-data.");
  }

  const growthTickers = new Set<string>(
    Array.isArray(data.growth?.tickers) ? data.growth.tickers : [],
  );
  const stocks = parseScannerPayload(
    data.scan.payload as { data?: Array<{ s?: string; d?: unknown[] }> },
    growthTickers,
  );
  if (stocks.length === 0) {
    throw new Error("TradingView returnerte ingen aksjer for Oslo Børs.");
  }

  const newsFetchedAt = data.news?.fetchedAt
    ? new Date(data.news.fetchedAt)
    : now;
  const newsSince = data.news?.since
    ? new Date(data.news.since)
    : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let news: NewsFeed;
  try {
    news = parseNewsPayload(
      data.news?.payload,
      newsSince,
      newsFetchedAt,
      newsSourceValue(data.news?.source),
      data.news?.warning ?? null,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    news = emptyNewsFeed(
      newsFetchedAt,
      newsSince,
      data.news?.warning ? `${data.news.warning} (${message})` : message,
    );
  }

  return {
    universe: {
      stocks,
      fetchedAt: data.scan.fetchedAt
        ? new Date(data.scan.fetchedAt)
        : now,
      source: sourceValue(data.scan.source),
      warning: data.scan.warning ?? null,
      growthTickers,
      growthSource: data.growth?.source
        ? newsSourceValue(data.growth.source)
        : "ukjent",
      growthWarning: data.growth?.warning ?? null,
    },
    news,
    benchmark: parseBenchmark(data.benchmark, now),
    generatedAt: data.generatedAt ? new Date(data.generatedAt) : now,
  };
}
