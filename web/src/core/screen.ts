import { formatPct } from "./format";
import type { Stock } from "./types";
import { distanceToAth, isGrowth, turnover as stockTurnover } from "./types";

export interface Criteria {
  minWeekReturn: number;
  athMargin: number;
  requireAboveSma5: boolean;
  requireAboveSma20: boolean;
  minMarketCap: number;
  minTurnover: number;
  includeTypes: string[];
  allowUnknownAth: boolean;
  includeAtHigh: boolean;
  excludeGrowth: boolean;
}

export const DEFAULT_CRITERIA: Criteria = {
  minWeekReturn: 0,
  athMargin: 0.01,
  requireAboveSma5: true,
  requireAboveSma20: false,
  minMarketCap: 0,
  minTurnover: 0,
  includeTypes: ["stock", "dr"],
  allowUnknownAth: false,
  includeAtHigh: true,
  excludeGrowth: true,
};

export interface ScreenResult {
  matches: Stock[];
  universeSize: number;
  excluded: Record<string, number>;
  atHighCount: number;
}

export const EXCLUSION_LABELS: Record<string, string> = {
  "euronext growth": "Euronext Growth (ikke ASK)",
  "ikke aksje": "Ikke aksje/DR",
  "mangler ukedata": "Mangler ukedata",
  "svak uke": "Ikke positiv uke",
  "under SMA5": "Under SMA5",
  "under SMA20": "Under SMA20",
  "for lav markedsverdi": "For lav markedsverdi",
  "for lavt omsetningsvolum": "For lavt volum",
  "på/ved ATH": "På/ved all-time high",
  "ukjent ATH": "Ukjent ATH",
  "ATH usikker": "ATH usikker (splitt?)",
};

function nearAth(stock: Stock, criteria: Criteria): boolean {
  const ref = stockReferenceAth(stock);
  return ref !== null && stock.close >= ref * (1 - criteria.athMargin);
}

function stockReferenceAth(stock: Stock): number | null {
  const values = [stock.ath, stock.high52w].filter(
    (value): value is number => value !== null && value > 0,
  );
  return values.length > 0 ? Math.max(...values) : null;
}

export function isAtHigh(stock: Stock, criteria: Criteria): boolean {
  if (!stockAthReliable(stock)) {
    return false;
  }
  const ref = stockReferenceAth(stock);
  if (ref === null) {
    return false;
  }
  return stock.close >= ref * (1 - criteria.athMargin);
}

function stockAthReliable(stock: Stock): boolean {
  if (stock.ath === null || stock.ath <= 0) {
    return false;
  }
  if (stock.high52w !== null && stock.high52w > 0) {
    if (stock.ath > stock.high52w * 50) {
      return false;
    }
  }
  return true;
}

export function evaluate(
  stock: Stock,
  criteria: Criteria,
): { passes: boolean; reason: string } {
  if (criteria.excludeGrowth && stock.market === "euronext_growth") {
    return { passes: false, reason: "euronext growth" };
  }
  if (!criteria.includeTypes.includes(stock.instrumentType)) {
    return { passes: false, reason: "ikke aksje" };
  }
  if (stock.weekReturn === null) {
    return { passes: false, reason: "mangler ukedata" };
  }
  if (stock.weekReturn <= criteria.minWeekReturn) {
    return { passes: false, reason: "svak uke" };
  }
  if (criteria.requireAboveSma5) {
    if (stock.sma5 === null || stock.close <= stock.sma5) {
      return { passes: false, reason: "under SMA5" };
    }
  }
  if (criteria.requireAboveSma20) {
    if (stock.sma20 === null || stock.close <= stock.sma20) {
      return { passes: false, reason: "under SMA20" };
    }
  }
  if (criteria.minMarketCap > 0) {
    if (stock.marketCap === null || stock.marketCap < criteria.minMarketCap) {
      return { passes: false, reason: "for lav markedsverdi" };
    }
  }
  if (criteria.minTurnover > 0) {
    const value = stockTurnover(stock);
    if (value === null || value < criteria.minTurnover) {
      return { passes: false, reason: "for lavt omsetningsvolum" };
    }
  }

  const ref = stockReferenceAth(stock);
  if (ref === null) {
    if (criteria.allowUnknownAth) {
      return { passes: true, reason: "" };
    }
    return { passes: false, reason: "ukjent ATH" };
  }

  const near = nearAth(stock, criteria);

  if (!stockAthReliable(stock)) {
    if (criteria.allowUnknownAth) {
      return { passes: true, reason: "" };
    }
    if (near) {
      return {
        passes: false,
        reason:
          stock.ath === null || stock.ath <= 0 ? "ukjent ATH" : "ATH usikker",
      };
    }
    const high52w = stock.high52w;
    if (
      high52w !== null &&
      high52w > 0 &&
      stock.close < high52w * (1 - criteria.athMargin)
    ) {
      return { passes: true, reason: "" };
    }
    return { passes: false, reason: "ATH usikker" };
  }

  if (near) {
    if (criteria.includeAtHigh) {
      return { passes: true, reason: "" };
    }
    return { passes: false, reason: "på/ved ATH" };
  }
  return { passes: true, reason: "" };
}

export function screen(stocks: Iterable<Stock>, criteria: Criteria): ScreenResult {
  const matches: Stock[] = [];
  const excluded: Record<string, number> = {};
  let atHighCount = 0;
  let universeSize = 0;
  for (const stock of stocks) {
    universeSize += 1;
    const result = evaluate(stock, criteria);
    if (result.passes) {
      matches.push(stock);
      if (isAtHigh(stock, criteria)) {
        atHighCount += 1;
      }
    } else {
      excluded[result.reason] = (excluded[result.reason] ?? 0) + 1;
    }
  }
  return { matches, universeSize, excluded, atHighCount };
}

export const SORT_FIELDS = [
  "week",
  "month",
  "close",
  "day",
  "marketCap",
  "turnover",
  "athDistance",
  "rsi",
  "name",
  "ticker",
] as const;

export type SortField = (typeof SORT_FIELDS)[number];

function sortValue(stock: Stock, field: SortField): number | null {
  if (field === "week") {
    return stock.weekReturn;
  }
  if (field === "month") {
    return stock.monthReturn;
  }
  if (field === "close") {
    return stock.close;
  }
  if (field === "day") {
    return stock.dayReturn;
  }
  if (field === "marketCap") {
    return stock.marketCap;
  }
  if (field === "turnover") {
    return stockTurnover(stock);
  }
  if (field === "athDistance") {
    return distanceToAth(stock);
  }
  if (field === "rsi") {
    return stock.rsi;
  }
  return null;
}

export function sortStocks(
  stocks: Iterable<Stock>,
  field: SortField = "week",
  direction: "asc" | "desc" = "desc",
): Stock[] {
  if (!SORT_FIELDS.includes(field)) {
    throw new Error(`Ukjent sorteringsfelt: ${field}`);
  }
  const items = Array.from(stocks);
  const descending = direction === "desc";
  if (field === "name" || field === "ticker") {
    return items.sort((a, b) => {
      const left = field === "name" ? a.name : a.ticker;
      const right = field === "name" ? b.name : b.ticker;
      const compared = left.localeCompare(right, "nb-NO", { sensitivity: "base" });
      const result =
        compared !== 0 ? compared : a.ticker.localeCompare(b.ticker);
      return descending ? -result : result;
    });
  }
  const sentinel = descending
    ? Number.NEGATIVE_INFINITY
    : Number.POSITIVE_INFINITY;
  return items.sort((a, b) => {
    const left = sortValue(a, field) ?? sentinel;
    const right = sortValue(b, field) ?? sentinel;
    return descending ? right - left : left - right;
  });
}

export function describeCriteria(criteria: Criteria): string {
  const parts = [`ukeavkastning > ${formatPct(criteria.minWeekReturn, 1, false)}`];
  if (criteria.requireAboveSma5) {
    parts.push("kurs > SMA5");
  }
  if (criteria.requireAboveSma20) {
    parts.push("kurs > SMA20");
  }
  if (criteria.includeAtHigh) {
    parts.push(`ATH-aksjer merkes (margin ${formatPct(criteria.athMargin, 1, false)})`);
  } else {
    parts.push(`minst ${formatPct(criteria.athMargin, 1, false)} under ATH`);
  }
  parts.push(
    criteria.excludeGrowth ? "Euronext Growth skjult" : "Euronext Growth med",
  );
  if (criteria.minMarketCap > 0) {
    parts.push(`markedsverdi ≥ ${(criteria.minMarketCap / 1e9).toFixed(1).replace(".", ",")} mrd`);
  }
  if (criteria.minTurnover > 0) {
    parts.push(`omsetning ≥ ${(criteria.minTurnover / 1e6).toFixed(1).replace(".", ",")} mill`);
  }
  return parts.join(" · ");
}

// Re-export for callers that previously imported these helpers from screen.
export { isGrowth };
