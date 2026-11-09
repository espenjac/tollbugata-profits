import { atrPct, averageTurnover, type Stock } from "./types";

/**
 * Medium-term, long-only trend strategy for the third paper portfolio.
 * It buys a nearby prior-session breakout only when the broader trend is
 * positive, then leaves the full position open behind a volatility stop.
 */
export const TREND_BREAKOUT_BUFFER = 0.003;
export const TREND_MAX_ENTRY_DISTANCE = 0.05;
export const TREND_STOP_ATR_MULTIPLE = 2;
export const TREND_MIN_STOP_PCT = 0.05;
export const TREND_MAX_STOP_PCT = 0.1;
export const TREND_PENDING_DAYS = 5;
export const TREND_MAX_HOLDING_DAYS = 60;
const TREND_MIN_AVERAGE_TURNOVER = 3_000_000;

export interface TrendIdea {
  stock: Stock;
  trigger: number;
  invalidation: number;
  entry: number;
  stopPct: number;
  stopPrice: number;
  shares: number;
  score: number;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function eligible(stock: Stock): boolean {
  const turnover = averageTurnover(stock);
  const atr = atrPct(stock);
  if (
    stock.market !== "oslo" ||
    !["stock", "dr"].includes(stock.instrumentType) ||
    stock.close < 5 ||
    stock.previousDayHigh === null ||
    stock.previousDayHigh <= 0 ||
    stock.sma20 === null ||
    stock.sma50 === null ||
    stock.monthReturn === null ||
    stock.quarterReturn === null ||
    stock.weekReturn === null ||
    stock.rsi === null ||
    turnover === null ||
    turnover < TREND_MIN_AVERAGE_TURNOVER ||
    atr === null ||
    stock.close <= stock.sma20 ||
    stock.sma20 <= stock.sma50 ||
    stock.monthReturn <= 0 ||
    stock.quarterReturn <= 0 ||
    stock.weekReturn <= 0 ||
    stock.weekReturn > 0.2 ||
    stock.rsi < 45 ||
    stock.rsi >= 75 ||
    stock.close / stock.sma20 - 1 > 0.1
  ) {
    return false;
  }

  const trigger = stock.previousDayHigh * (1 + TREND_BREAKOUT_BUFFER);
  return Math.abs(trigger / stock.close - 1) <= TREND_MAX_ENTRY_DISTANCE;
}

function score(stock: Stock): number {
  const month = stock.monthReturn ?? 0;
  const quarter = stock.quarterReturn ?? 0;
  const week = stock.weekReturn ?? 0;
  const sma20 = stock.sma20 ?? stock.close;
  const sma50 = stock.sma50 ?? stock.close;
  const close = stock.close;
  const extension = close / sma20 - 1;
  const trendStack = sma20 / sma50 - 1;

  return (
    30 * clamp(month / 0.25) +
    30 * clamp(quarter / 0.5) +
    20 * clamp(week / 0.15) +
    15 * clamp(trendStack / 0.12) +
    5 * (1 - clamp(extension / 0.1))
  );
}

export function buildTrendIdeas(
  stocks: Iterable<Stock>,
  capital: number,
  buyFee: number,
): TrendIdea[] {
  const ideas: TrendIdea[] = [];
  for (const stock of stocks) {
    if (!eligible(stock)) {
      continue;
    }
    const trigger = stock.previousDayHigh! * (1 + TREND_BREAKOUT_BUFFER);
    const entry = Math.max(stock.close, trigger);
    const atr = atrPct(stock)!;
    const stopPct = clamp(
      atr * TREND_STOP_ATR_MULTIPLE,
      TREND_MIN_STOP_PCT,
      TREND_MAX_STOP_PCT,
    );
    const shares = Math.floor(Math.max(0, capital - buyFee) / entry);
    const invalidation = stock.sma20! * 0.99;
    if (shares <= 0 || invalidation >= stock.close) {
      continue;
    }
    ideas.push({
      stock,
      trigger,
      invalidation,
      entry,
      stopPct,
      stopPrice: entry * (1 - stopPct),
      shares,
      score: score(stock),
    });
  }
  return ideas.sort(
    (left, right) =>
      right.score - left.score ||
      left.stock.ticker.localeCompare(right.stock.ticker),
  );
}
