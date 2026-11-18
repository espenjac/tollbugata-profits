import { atrPct, averageTurnover, type Stock } from "./types";

/** Trendline scanner settings are deliberately conservative and not optimized. */
export const TRENDLINE_LOOKBACKS = [
  { months: 3, sessions: 63 },
  { months: 6, sessions: 126 },
] as const;
export const TRENDLINE_PIVOT_RADIUS = 2;
export const TRENDLINE_MIN_ATR_PCT = 0.015;
export const TRENDLINE_MAX_DISTANCE_ATR = 2.5;
export const TRENDLINE_MAX_BREAK_ATR = 0.5;
export const TRENDLINE_ON_LINE_ATR = 0.25;
export const TRENDLINE_BOUNCE_TOUCH_ATR = 0.5;
export const TRENDLINE_BOUNCE_RECOVERY_ATR = 0.15;
export const TRENDLINE_BOUNCE_MAX_DISTANCE_ATR = 3;
const MIN_TURNOVER = 3_000_000;
const MIN_ANCHOR_GAP = 4;
const MIN_LINE_RISE = 0.005;
const MAX_LINE_RISE = 0.5;

interface Pivot {
  index: number;
  price: number;
}

export interface TrendlineSetup {
  stock: Stock;
  lookbackMonths: 3 | 6;
  phase: TrendlinePhase;
  quality: "stronger" | "weaker";
  supportPrice: number;
  distancePct: number;
  volatilityPct: number;
  lineRisePct: number;
  anchorGap: number;
  touches: number;
  score: number;
}

export type TrendlinePhase = "approaching" | "bounced" | "on_line";

function classifyPhase(
  stock: Stock,
  supportPrice: number,
  distancePct: number,
  volatilityPct: number,
): TrendlinePhase | null {
  const low = stock.low;
  if (isPositive(low)) {
    const lowDistancePct = low / supportPrice - 1;
    const recoveryPct = (stock.close - low) / stock.close;
    if (
      lowDistancePct >= -volatilityPct * TRENDLINE_BOUNCE_TOUCH_ATR &&
      lowDistancePct <= volatilityPct * TRENDLINE_BOUNCE_TOUCH_ATR &&
      distancePct > volatilityPct * TRENDLINE_ON_LINE_ATR &&
      distancePct <= volatilityPct * TRENDLINE_BOUNCE_MAX_DISTANCE_ATR &&
      recoveryPct >= volatilityPct * TRENDLINE_BOUNCE_RECOVERY_ATR
    ) {
      return "bounced";
    }
  }

  if (
    distancePct >= -volatilityPct * TRENDLINE_MAX_BREAK_ATR &&
    distancePct <= volatilityPct * TRENDLINE_ON_LINE_ATR
  ) {
    return "on_line";
  }
  if (
    distancePct > volatilityPct * TRENDLINE_ON_LINE_ATR &&
    distancePct <= volatilityPct * TRENDLINE_MAX_DISTANCE_ATR
  ) {
    return "approaching";
  }
  return null;
}

function isPositive(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0;
}

function pivots(lows: Array<number | null>): Pivot[] {
  const found: Pivot[] = [];
  const radius = TRENDLINE_PIVOT_RADIUS;
  for (let index = radius; index < lows.length - radius; index += 1) {
    const price = lows[index];
    if (!isPositive(price)) {
      continue;
    }
    const neighbors = lows.slice(index - radius, index + radius + 1);
    const valid = neighbors.every(isPositive);
    if (
      valid &&
      neighbors.every((value) => price <= value) &&
      neighbors.some((value) => price < value)
    ) {
      found.push({ index, price });
    }
  }
  return found;
}

function setupFor(
  stock: Stock,
  lookback: (typeof TRENDLINE_LOOKBACKS)[number],
): TrendlineSetup | null {
  const history = stock.recentLows;
  const lows = history && history.length >= lookback.sessions
    ? history.slice(-lookback.sessions)
    : null;
  const volatilityPct = atrPct(stock);
  const turnover = averageTurnover(stock);
  if (
    stock.market !== "oslo" ||
    !["stock", "dr"].includes(stock.instrumentType) ||
    stock.close < 5 ||
    !lows ||
    lows.length < 12 ||
    volatilityPct === null ||
    volatilityPct < TRENDLINE_MIN_ATR_PCT ||
    turnover === null ||
    turnover < MIN_TURNOVER
  ) {
    return null;
  }

  const lowsWithIndex = lows.map((price, index) => ({ price, index }));
  const validLows = lowsWithIndex.filter(
    (point): point is { price: number; index: number } => isPositive(point.price),
  );
  const turningPoints = pivots(lows);
  if (validLows.length < 10 || turningPoints.length < 2) {
    return null;
  }

  const tolerance = stock.close * volatilityPct * 0.75;
  const possible: TrendlineSetup[] = [];
  for (let first = 0; first < turningPoints.length - 1; first += 1) {
    for (let second = first + 1; second < turningPoints.length; second += 1) {
      const older = turningPoints[first];
      const newer = turningPoints[second];
      const gap = newer.index - older.index;
      if (gap < MIN_ANCHOR_GAP) {
        continue;
      }
      const lineRisePct = newer.price / older.price - 1;
      if (lineRisePct < MIN_LINE_RISE || lineRisePct > MAX_LINE_RISE) {
        continue;
      }
      const slope = (newer.price - older.price) / gap;
      const valueAt = (index: number) => older.price + slope * (index - older.index);
      // Discard a line that runs materially above any intervening daily low.
      if (validLows.some((point) => point.price < valueAt(point.index) - tolerance)) {
        continue;
      }

      const touches = turningPoints.filter(
        (point) => Math.abs(point.price - valueAt(point.index)) <= tolerance,
      ).length;
      const supportPrice = valueAt(lows.length);
      const distancePct = stock.close / supportPrice - 1;
      const phase = classifyPhase(stock, supportPrice, distancePct, volatilityPct);
      if (phase === null) {
        continue;
      }

      const proximityScore = 40 * (1 - Math.min(
        Math.abs(distancePct) / (volatilityPct * TRENDLINE_MAX_DISTANCE_ATR),
        1,
      ));
      const touchScore = Math.min(20, Math.max(0, touches - 1) * 10);
      const riseScore = 15 * Math.min(lineRisePct / 0.15, 1);
      const volatilityScore = 25 * Math.min(volatilityPct / 0.05, 1);
      const quality =
        gap >= 8 &&
        lineRisePct >= 0.02 &&
        touches >= 3 &&
        Math.abs(distancePct) <= volatilityPct * 1.5
          ? "stronger"
          : "weaker";
      possible.push({
        stock,
        lookbackMonths: lookback.months,
        phase,
        quality,
        supportPrice,
        distancePct,
        volatilityPct,
        lineRisePct,
        anchorGap: gap,
        touches,
        score: proximityScore + touchScore + riseScore + volatilityScore,
      });
    }
  }
  return possible.sort((left, right) => right.score - left.score)[0] ?? null;
}

/** Finds liquid, higher-volatility Oslo shares approaching rising 3- or 6-month support lines. */
export function findTrendlineSetups(stocks: Iterable<Stock>): TrendlineSetup[] {
  const setups: TrendlineSetup[] = [];
  for (const stock of stocks) {
    for (const lookback of TRENDLINE_LOOKBACKS) {
      const setup = setupFor(stock, lookback);
      if (setup) {
        setups.push(setup);
      }
    }
  }
  return setups.sort(
    (left, right) =>
      right.score - left.score ||
      right.volatilityPct - left.volatilityPct ||
      left.stock.ticker.localeCompare(right.stock.ticker) ||
      left.lookbackMonths - right.lookbackMonths,
  );
}
