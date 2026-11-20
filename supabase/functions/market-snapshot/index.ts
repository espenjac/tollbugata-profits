// Fetches TradingView, Euronext Growth and NewsWeb server-side, caches the
// results in Supabase and returns normalized raw payloads to the PWA. Scanner
// data is cached for 30 seconds while Oslo Børs is open and 10 minutes outside
// market hours.
//
// Deploy with:
//   supabase functions deploy market-snapshot
//
// Optional function secrets (recommended):
//   ALLOWED_EMAILS=you@example.com,partner@example.com
//
// OWNER_EMAIL is still supported as a single-address fallback.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SCAN_URL = "https://scanner.tradingview.com/norway/scan";
const BENCHMARK_TICKER = "OSL:OSEBX";
const BENCHMARK_NAME = "Oslo Børs Benchmark GI Index";
const GROWTH_URL =
  "https://live.euronext.com/en/product_directory/data/stocks-oslo-euronext-growth-";
const NEWS_URL = "https://api3.oslo.oslobors.no/v1/newsreader/list";

const SCAN_TTL_SECONDS = 600;
const OPEN_SCAN_TTL_SECONDS = 30;
const NEWS_TTL_SECONDS = 300;
const GROWTH_TTL_SECONDS = 24 * 60 * 60;
const TRENDLINE_HISTORY_TTL_SECONDS = 15 * 60;
const TRENDLINE_HISTORY_SESSIONS = 126;
const TRENDLINE_HISTORY_CONCURRENCY = 8;

const SCAN_COLUMNS = [
  "name",
  "description",
  "close",
  "currency",
  "change",
  "Perf.W",
  "Perf.1M",
  "Perf.3M",
  "Perf.6M",
  "Perf.Y",
  "SMA5",
  "SMA20",
  "SMA50",
  "SMA200",
  "RSI",
  "High.All",
  "price_52_week_high",
  "volume",
  "average_volume_10d_calc",
  "market_cap_basic",
  "sector",
  "exchange",
  "type",
  "typespecs",
  "earnings_release_next_date",
  "dividend_ex_date_upcoming",
  "ATR",
  "open",
  "high",
  "high[1]",
  "low",
  "VWAP",
];

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 TollbugataProfits/2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CacheRow {
  key: string;
  payload: unknown;
  fetched_at: string;
  expires_at: string;
  source: string;
}

interface BenchmarkPayload {
  ticker: string;
  name: string;
  value: number;
  changePct: number | null;
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
  retries = 3,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Expected a JSON object.");
      }
      return payload as Record<string, unknown>;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(2 ** (attempt - 1), 4) * 1000)
        );
      }
    }
  }
  throw new Error(errorMessage(lastError));
}

async function readCache(key: string): Promise<CacheRow | null> {
  const { data, error } = await admin
    .from("market_cache")
    .select("key,payload,fetched_at,expires_at,source")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.warn("market_cache read failed", key, error.message);
    return null;
  }
  return (data as CacheRow | null) ?? null;
}

async function writeCache(
  key: string,
  payload: unknown,
  ttlSeconds: number,
): Promise<void> {
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + ttlSeconds * 1000);
  const { error } = await admin.from("market_cache").upsert(
    {
      key,
      payload,
      fetched_at: fetchedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      source: "live",
    },
    { onConflict: "key" },
  );
  if (error) {
    console.warn("market_cache write failed", key, error.message);
  }
}

function isFresh(
  row: CacheRow | null,
  maxAgeSeconds?: number,
): boolean {
  if (row === null) {
    return false;
  }
  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    return false;
  }
  if (
    maxAgeSeconds !== undefined &&
    now - new Date(row.fetched_at).getTime() >= maxAgeSeconds * 1000
  ) {
    return false;
  }
  return true;
}

function osloDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isOsloMarketOpen(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdays[get("weekday")] ?? 0;
  if (weekday === 0 || weekday === 6) {
    return false;
  }
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 9 * 60 && minutes <= 16 * 60 + 30;
}

function scanTtlSeconds(now: Date): number {
  return isOsloMarketOpen(now) ? OPEN_SCAN_TTL_SECONDS : SCAN_TTL_SECONDS;
}

function newsWindowStart(now: Date): Date {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const current = new Date(
    Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))),
  );
  current.setUTCDate(current.getUTCDate() - 1);
  while (current.getUTCDay() === 0 || current.getUTCDay() === 6) {
    current.setUTCDate(current.getUTCDate() - 1);
  }
  const dateString = current.toISOString().slice(0, 10);
  // Build 16:30 Oslo time. Date.UTC is a safe intermediate because the offset
  // is applied by converting the local wall-clock string through Intl below.
  const local = new Date(`${dateString}T16:30:00`);
  const utcGuess = new Date(
    Date.UTC(
      local.getFullYear(),
      local.getMonth(),
      local.getDate(),
      16,
      30,
    ),
  );
  const offsetMinutes = osloOffsetMinutes(utcGuess);
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function osloOffsetMinutes(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return (asUtc - date.getTime()) / 60_000;
}

async function getScan(
  cacheKey: string,
  ttlSeconds: number,
) {
  const cached = await readCache(cacheKey);
  if (isFresh(cached, ttlSeconds)) {
    return {
      payload: cached?.payload,
      fetchedAt: cached?.fetched_at,
      source: "cache",
      warning: null,
    };
  }
  try {
    const payload = await fetchJson(SCAN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.tradingview.com",
        Referer:
          "https://www.tradingview.com/markets/stocks-norway/market-movers-all-stocks/",
      },
      body: JSON.stringify({
        filter: [{ left: "exchange", operation: "equal", right: "OSL" }],
        options: { lang: "en" },
        columns: SCAN_COLUMNS,
        sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
        range: [0, 1000],
      }),
    });
    if (!Array.isArray(payload.data)) {
      throw new Error("TradingView response is missing data[]");
    }
    await writeCache(cacheKey, payload, ttlSeconds);
    return {
      payload,
      fetchedAt: new Date().toISOString(),
      source: "live",
      warning: null,
    };
  } catch (error) {
    const stale = cached;
    if (stale) {
      return {
        payload: stale.payload,
        fetchedAt: stale.fetched_at,
        source: "stale-cache",
        warning:
          `Ferske data kunne ikke hentes (${errorMessage(error)}). ` +
          `Viser cache fra ${stale.fetched_at}.`,
      };
    }
    throw new Error(`Kunne ikke hente TradingView-data: ${errorMessage(error)}`);
  }
}

function normalizeTicker(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function trendlineHistoryTickers(
  payload: Record<string, unknown> | undefined,
  growthTickers: string[],
): string[] {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const growth = new Set(growthTickers.map(normalizeTicker));
  const indexOf = (column: string) =>
    SCAN_COLUMNS.indexOf(column as typeof SCAN_COLUMNS[number]);
  const tickerIndex = indexOf("name");
  const closeIndex = indexOf("close");
  const averageVolumeIndex = indexOf("average_volume_10d_calc");
  const atrIndex = indexOf("ATR");
  const typeIndex = indexOf("type");
  const tickers = new Set<string>();

  for (const row of rows) {
    const values = (row as { d?: unknown[] } | null)?.d;
    if (!Array.isArray(values)) {
      continue;
    }
    const ticker = String(values[tickerIndex] ?? "").trim();
    const close = numberOrNull(values[closeIndex]);
    const averageVolume = numberOrNull(values[averageVolumeIndex]);
    const atr = numberOrNull(values[atrIndex]);
    const type = String(values[typeIndex] ?? "");
    if (
      !ticker ||
      growth.has(normalizeTicker(ticker)) ||
      !["stock", "dr"].includes(type) ||
      close === null ||
      close < 5 ||
      averageVolume === null ||
      close * averageVolume < 3_000_000 ||
      atr === null ||
      atr / close < 0.015
    ) {
      continue;
    }
    tickers.add(ticker);
  }
  return [...tickers];
}

function parseYahooHistory(
  payload: Record<string, unknown>,
  today: string,
): { dates: string[]; lows: Array<number | null>; highs: Array<number | null> } {
  const chart = payload.chart as Record<string, unknown> | undefined;
  const result = Array.isArray(chart?.result)
    ? chart.result[0] as Record<string, unknown> | undefined
    : undefined;
  const timestamps = Array.isArray(result?.timestamp)
    ? result.timestamp as unknown[]
    : [];
  const indicators = result?.indicators as Record<string, unknown> | undefined;
  const quotes = Array.isArray(indicators?.quote)
    ? indicators.quote[0] as Record<string, unknown> | undefined
    : undefined;
  const lows = Array.isArray(quotes?.low) ? quotes.low as unknown[] : [];
  const highs = Array.isArray(quotes?.high) ? quotes.high as unknown[] : [];
  const history: Array<{ date: string; low: number; high: number | null }> = [];

  for (
    let index = 0;
    index < Math.min(timestamps.length, lows.length, highs.length);
    index += 1
  ) {
    const timestamp = numberOrNull(timestamps[index]);
    if (timestamp === null) {
      continue;
    }
    const date = osloDateString(new Date(timestamp * 1000));
    if (date >= today) {
      continue;
    }
    const low = numberOrNull(lows[index]);
    if (low !== null) {
      history.push({ date, low, high: numberOrNull(highs[index]) });
    }
  }
  const recent = history.slice(-TRENDLINE_HISTORY_SESSIONS);
  return {
    dates: recent.map((item) => item.date),
    lows: recent.map((item) => item.low),
    highs: recent.map((item) => item.high),
  };
}

async function getTickerTrendlineHistory(ticker: string, today: string) {
  const cacheKey = `trendline-history-v3:${normalizeTicker(ticker)}`;
  const cached = await readCache(cacheKey);
  const cachedPayload = cached?.payload as
    | { lows?: unknown; highs?: unknown; dates?: unknown }
    | undefined;
  const cachedLows = Array.isArray(cachedPayload?.lows)
    ? cachedPayload.lows as Array<number | null>
    : null;
  const cachedHighs = Array.isArray(cachedPayload?.highs)
    ? cachedPayload.highs as Array<number | null>
    : null;
  const cachedDates = Array.isArray(cachedPayload?.dates)
    ? cachedPayload.dates as Array<string | null>
    : null;
  if (
    isFresh(cached) &&
    cachedLows &&
    cachedHighs &&
    cachedDates &&
    cachedLows.length >= 21 &&
    cachedDates.length === cachedLows.length &&
    cachedHighs.length === cachedLows.length
  ) {
    return {
      ticker,
      lows: cachedLows,
      highs: cachedHighs,
      dates: cachedDates,
      source: "cache" as const,
    };
  }

  try {
    const symbol = `${ticker}.OL`;
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      "?range=1y&interval=1d&events=div%2Csplits";
    const payload = await fetchJson(
      url,
      { headers: { "User-Agent": USER_AGENT } },
      1,
      6_000,
    );
    const history = parseYahooHistory(payload, today);
    if (history.lows.filter((low) => low !== null).length < 21) {
      throw new Error("Yahoo Finance returnerte for få daglige kurser.");
    }
    await writeCache(cacheKey, history, TRENDLINE_HISTORY_TTL_SECONDS);
    return { ticker, ...history, source: "live" as const };
  } catch (error) {
    if (
      cachedLows &&
      cachedHighs &&
      cachedDates &&
      cachedLows.length >= 21 &&
      cachedDates.length === cachedLows.length &&
      cachedHighs.length === cachedLows.length
    ) {
      return {
        ticker,
        lows: cachedLows,
        highs: cachedHighs,
        dates: cachedDates,
        source: "stale-cache" as const,
      };
    }
    console.warn("Trendline history unavailable", ticker, errorMessage(error));
    return {
      ticker,
      lows: null,
      highs: null,
      dates: null,
      source: "error" as const,
    };
  }
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  callback: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) {
          return;
        }
        results[index] = await callback(values[index]);
      }
    }),
  );
  return results;
}

async function getTrendlineHistory(
  scanPayload: Record<string, unknown> | undefined,
  growthTickers: string[],
) {
  const today = osloDateString(new Date());
  const tickers = trendlineHistoryTickers(scanPayload, growthTickers);
  const results = await mapConcurrent(
    tickers,
    TRENDLINE_HISTORY_CONCURRENCY,
    (ticker) => getTickerTrendlineHistory(ticker, today),
  );
  const lowsByTicker: Record<string, Array<number | null>> = {};
  const highsByTicker: Record<string, Array<number | null>> = {};
  const datesByTicker: Record<string, Array<string | null>> = {};
  for (const result of results) {
    if (result.lows && result.highs && result.dates) {
      const ticker = normalizeTicker(result.ticker);
      lowsByTicker[ticker] = result.lows;
      highsByTicker[ticker] = result.highs;
      datesByTicker[ticker] = result.dates;
    }
  }
  const failed = results.filter((result) => result.lows === null).length;
  const source = results.some((result) => result.source === "stale-cache")
    ? "stale-cache"
    : results.some((result) => result.source === "live")
    ? "live"
    : "cache";
  return {
    lowsByTicker,
    highsByTicker,
    datesByTicker,
    fetchedAt: new Date().toISOString(),
    source,
    warning: failed > 0
      ? `Historiske kurser mangler for ${failed} av ${tickers.length} aktuelle aksjer.`
      : null,
  };
}

function normalizeBenchmark(
  payload: Record<string, unknown> | null | undefined,
): BenchmarkPayload | null {
  if (!payload) {
    return null;
  }
  const value = Number(payload.value);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return {
    ticker: typeof payload.ticker === "string" && payload.ticker.trim()
      ? payload.ticker.trim()
      : "OSEBX",
    name: typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : BENCHMARK_NAME,
    value,
    changePct: typeof payload.changePct === "number" &&
        Number.isFinite(payload.changePct)
      ? payload.changePct
      : null,
  };
}

/**
 * Fetches the Oslo Børs benchmark index (OSEBX). A missing index must never
 * break the report, so failures return a null value instead of throwing.
 */
async function getBenchmark(ttlSeconds: number) {
  const cached = await readCache("benchmark");
  if (isFresh(cached, ttlSeconds)) {
    const payload = normalizeBenchmark(
      cached?.payload as Record<string, unknown> | undefined,
    );
    if (payload) {
      return {
        ...payload,
        fetchedAt: cached?.fetched_at,
        source: "cache",
        warning: null,
      };
    }
  }

  try {
    const payload = await fetchJson(SCAN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.tradingview.com",
        Referer:
          "https://www.tradingview.com/markets/stocks-norway/market-movers-all-stocks/",
      },
      body: JSON.stringify({
        symbols: { tickers: [BENCHMARK_TICKER], query: { types: [] } },
        columns: ["name", "description", "close", "change"],
      }),
    });
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const row = rows[0] as { d?: unknown[] } | undefined;
    const values = Array.isArray(row?.d) ? row.d : [];
    const change = values[3];
    const benchmark = normalizeBenchmark({
      ticker: values[0],
      name: values[1],
      value: values[2],
      changePct: change === null || change === undefined ? null : Number(change),
    });
    if (!benchmark) {
      throw new Error("TradingView returned no benchmark value");
    }
    await writeCache("benchmark", benchmark, ttlSeconds);
    return {
      ...benchmark,
      fetchedAt: new Date().toISOString(),
      source: "live",
      warning: null,
    };
  } catch (error) {
    const stale = normalizeBenchmark(
      cached?.payload as Record<string, unknown> | undefined,
    );
    if (stale) {
      return {
        ...stale,
        fetchedAt: cached?.fetched_at,
        source: "stale-cache",
        warning:
          `Fersk OSEBX-kurs kunne ikke hentes (${errorMessage(error)}). ` +
          `Viser cache fra ${cached?.fetched_at}.`,
      };
    }
    return {
      ticker: "OSEBX",
      name: BENCHMARK_NAME,
      value: null,
      changePct: null,
      fetchedAt: new Date().toISOString(),
      source: "error",
      warning: `Kunne ikke hente OSEBX-indeksen: ${errorMessage(error)}`,
    };
  }
}

function parseGrowthTickers(payload: Record<string, unknown>): string[] {
  const rows = payload.aaData;
  if (!Array.isArray(rows)) {
    throw new Error("Euronext response is missing aaData[]");
  }
  const tickers = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) {
      continue;
    }
    const market = row.length > 3 ? String(row[3]) : "";
    if (market && !market.toLowerCase().includes("growth")) {
      continue;
    }
    const ticker = String(row[2] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (ticker) {
      tickers.add(ticker);
    }
  }
  const expected = Number(payload.iTotalRecords);
  if (Number.isFinite(expected) && expected > 0 && rows.length < expected) {
    throw new Error(`Incomplete Euronext list: ${rows.length} of ${expected} rows`);
  }
  if (tickers.size === 0) {
    throw new Error("Euronext Growth list was empty");
  }
  return [...tickers].sort();
}

async function getGrowth() {
  const cached = await readCache("growth");
  if (isFresh(cached)) {
    const payload = cached?.payload as { tickers?: unknown } | undefined;
    if (payload && Array.isArray(payload.tickers)) {
      return {
        tickers: payload.tickers,
        fetchedAt: cached?.fetched_at,
        source: "cache",
        warning: null,
      };
    }
  }
  try {
    const payload = await fetchJson(
      `${GROWTH_URL}?mics=MERK&page=0&pageSize=10000`,
    );
    const tickers = parseGrowthTickers(payload);
    await writeCache("growth", { tickers }, GROWTH_TTL_SECONDS);
    return {
      tickers,
      fetchedAt: new Date().toISOString(),
      source: "live",
      warning: null,
    };
  } catch (error) {
    const cachedTickers = (cached?.payload as { tickers?: unknown } | undefined)
      ?.tickers;
    if (Array.isArray(cachedTickers)) {
      return {
        tickers: cachedTickers,
        fetchedAt: cached?.fetched_at,
        source: "stale-cache",
        warning:
          `Fersk Euronext Growth-liste kunne ikke hentes (${errorMessage(error)}). ` +
          `Bruker cache fra ${cached?.fetched_at}; nye eller endrede segmenter kan mangle.`,
      };
    }
    return {
      tickers: [],
      fetchedAt: new Date().toISOString(),
      source: "error",
      warning:
        `Euronext Growth-listen kunne ikke hentes (${errorMessage(error)}). ` +
        "Aksjer på Euronext Growth kan derfor være med i listen.",
    };
  }
}

async function getNews() {
  const now = new Date();
  const since = newsWindowStart(now);
  const sinceIso = since.toISOString();
  const cached = await readCache("news");
  const cachedPayload = cached?.payload as
    | { since?: unknown; payload?: unknown }
    | undefined;
  const cachedSince = typeof cachedPayload?.since === "string"
    ? cachedPayload.since
    : null;
  const cachedNewsPayload =
    cachedPayload && typeof cachedPayload.payload === "object"
      ? cachedPayload.payload
      : null;

  if (isFresh(cached) && cachedSince === sinceIso && cachedNewsPayload) {
    return {
      payload: cachedNewsPayload,
      since: cachedSince,
      fetchedAt: cached?.fetched_at,
      source: "cache",
      warning: null,
    };
  }

  try {
    const query = new URLSearchParams({
      fromDate: osloDateString(since),
      toDate: osloDateString(now),
    });
    const payload = await fetchJson(`${NEWS_URL}?${query.toString()}`);
    const data = payload.data;
    if (!data || typeof data !== "object" || !Array.isArray((data as Record<string, unknown>).messages)) {
      throw new Error("NewsWeb response is missing data.messages[]");
    }
    await writeCache("news", { since: sinceIso, payload }, NEWS_TTL_SECONDS);
    return {
      payload,
      since: sinceIso,
      fetchedAt: new Date().toISOString(),
      source: "live",
      warning: null,
    };
  } catch (error) {
    if (cachedNewsPayload && cachedSince) {
      return {
        payload: cachedNewsPayload,
        since: cachedSince,
        fetchedAt: cached?.fetched_at,
        source: "stale-cache",
        warning:
          `Ferske børsmeldinger kunne ikke hentes (${errorMessage(error)}). ` +
          `Viser cache fra ${cached?.fetched_at}.`,
      };
    }
    return {
      payload: { data: { messages: [] } },
      since: sinceIso,
      fetchedAt: now.toISOString(),
      source: "error",
      warning: `Kunne ikke hente børsmeldinger: ${errorMessage(error)}`,
    };
  }
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // The scheduled simulator calls this function server-to-server. It is
    // authenticated with a dedicated shared secret instead of a user JWT.
    const internalSecret = Deno.env.get("SIMULATOR_SECRET") ?? "";
    const providedSecret = request.headers.get("x-internal-secret") ?? "";
    const internalRequest =
      internalSecret.length > 0 && providedSecret === internalSecret;

    if (!internalRequest) {
      const authorization = request.headers.get("Authorization") ?? "";
      const token = authorization.replace(/^Bearer\s+/i, "");
      if (!token) {
        return json({ error: "Missing bearer token" }, 401);
      }
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) {
        return json({ error: "Invalid session" }, 401);
      }
      const allowedEmails = [
        Deno.env.get("ALLOWED_EMAILS") ?? "",
        Deno.env.get("OWNER_EMAIL") ?? "",
      ]
        .join(",")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
      const userEmail = data.user.email?.trim().toLowerCase();
      if (
        allowedEmails.length > 0 &&
        (!userEmail || !allowedEmails.includes(userEmail))
      ) {
        return json({ error: "This account is not allowed" }, 403);
      }
    }

    const scanTtl = scanTtlSeconds(new Date());
    const [scan, growth, news, benchmark] = await Promise.all([
      // Version the cache key when the scanner column order changes so cached
      // rows from the previous schema cannot be parsed with shifted indexes.
      getScan("scan-v4", scanTtl),
      getGrowth(),
      getNews(),
      getBenchmark(scanTtl),
    ]);
    const trendlineHistory = await getTrendlineHistory(
      scan.payload as Record<string, unknown> | undefined,
      growth.tickers,
    );
    return json({
      generatedAt: new Date().toISOString(),
      scan,
      growth,
      news,
      benchmark,
      trendlineHistory,
    });
  } catch (error) {
    console.error("market-snapshot failed", error);
    return json({ error: errorMessage(error) }, 502);
  }
});
