import { osloDateString } from "./dates";
import type { Stock } from "./types";

export const SCANNER_URL = "https://scanner.tradingview.com/norway/scan";

export const SCANNER_COLUMNS = [
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
] as const;

export class MarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataError";
  }
}

export function normalizeTicker(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return number;
}

function percentValue(value: unknown): number | null {
  const number = numberValue(value);
  return number === null ? null : number / 100;
}

function dateValue(value: unknown): string | null {
  if (value === null || value === undefined || typeof value === "boolean") {
    return null;
  }
  if (typeof value === "number") {
    if (value <= 0) {
      return null;
    }
    const timestamp = value > 1e11 ? value : value * 1000;
    return osloDateString(new Date(timestamp));
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return null;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      return text.slice(0, 10);
    }
    const asNumber = Number(text);
    if (Number.isFinite(asNumber)) {
      return dateValue(asNumber);
    }
  }
  return null;
}

export interface ScannerPayload {
  data?: Array<{ s?: string; d?: unknown[] }>;
}

export function parseScannerPayload(
  payload: ScannerPayload,
  growthTickers: Iterable<string> = [],
): Stock[] {
  if (!Array.isArray(payload.data)) {
    throw new MarketDataError("Svar fra TradingView mangler 'data'-listen.");
  }

  const growth = new Set(
    Array.from(growthTickers)
      .map((ticker) => normalizeTicker(ticker))
      .filter(Boolean),
  );
  const stocks: Stock[] = [];

  for (const row of payload.data) {
    if (!row || !Array.isArray(row.d)) {
      continue;
    }
    const values = new Map<string, unknown>();
    SCANNER_COLUMNS.forEach((column, index) => values.set(column, row.d?.[index]));

    const symbol = String(row.s ?? "");
    const ticker = String(values.get("name") ?? symbol.split(":").at(-1) ?? "").trim();
    if (!ticker) {
      continue;
    }
    const close = numberValue(values.get("close"));
    if (close === null || close <= 0) {
      continue;
    }
    const name = String(values.get("description") ?? ticker).trim();
    const currency = String(values.get("currency") ?? "NOK").trim();
    const sector = String(values.get("sector") ?? "Ukjent").trim();
    const instrumentType = String(values.get("type") ?? "stock").trim();
    const market = growth.has(normalizeTicker(ticker)) ? "euronext_growth" : "oslo";

    stocks.push({
      ticker,
      name,
      close,
      currency,
      dayReturn: percentValue(values.get("change")),
      weekReturn: percentValue(values.get("Perf.W")),
      monthReturn: percentValue(values.get("Perf.1M")),
      quarterReturn: percentValue(values.get("Perf.3M")),
      sma5: numberValue(values.get("SMA5")),
      sma20: numberValue(values.get("SMA20")),
      sma50: numberValue(values.get("SMA50")),
      rsi: numberValue(values.get("RSI")),
      ath: numberValue(values.get("High.All")),
      high52w: numberValue(values.get("price_52_week_high")),
      marketCap: numberValue(values.get("market_cap_basic")),
      volume: numberValue(values.get("volume")),
      sector,
      instrumentType,
      market,
      earningsDate: dateValue(values.get("earnings_release_next_date")),
      exDividendDate: dateValue(values.get("dividend_ex_date_upcoming")),
      averageVolume10d: numberValue(values.get("average_volume_10d_calc")),
      atr: numberValue(values.get("ATR")),
    });
  }

  return stocks;
}

export interface GrowthPayload {
  aaData?: unknown[];
  iTotalRecords?: unknown;
}

export function parseGrowthPayload(payload: GrowthPayload): Set<string> {
  if (!Array.isArray(payload.aaData)) {
    throw new MarketDataError(
      "Svaret fra Euronext mangler listen over Euronext Growth-aksjer.",
    );
  }
  const tickers = new Set<string>();
  for (const row of payload.aaData) {
    if (!Array.isArray(row) || row.length < 3) {
      continue;
    }
    const market = row.length > 3 ? String(row[3]) : "";
    if (market && !market.toLowerCase().includes("growth")) {
      continue;
    }
    const ticker = normalizeTicker(row[2]);
    if (ticker) {
      tickers.add(ticker);
    }
  }
  const expected = Number(payload.iTotalRecords);
  if (
    Number.isFinite(expected) &&
    expected > 0 &&
    payload.aaData.length < expected
  ) {
    throw new MarketDataError(
      `Ufullstendig Euronext Growth-liste: fikk ${payload.aaData.length} av ${expected} rader.`,
    );
  }
  if (tickers.size === 0) {
    throw new MarketDataError(
      "Euronext Growth-listen var tom eller hadde uventet format.",
    );
  }
  return tickers;
}
