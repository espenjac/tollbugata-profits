import { atrPct, averageTurnover, type Stock } from "./types";

/** Trendline scanner settings are deliberately conservative and not optimized. */
export const TRENDLINE_LOOKBACKS = [
  { months: 1, sessions: 21 },
  { months: 3, sessions: 63 },
  { months: 6, sessions: 126 },
] as const;
export const TRENDLINE_PIVOT_RADIUS = 2;
export const TRENDLINE_MIN_ATR_PCT = 0.015;
export const TRENDLINE_MAX_DISTANCE_ATR = 2.5;
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
  lookbackMonths: 1 | 3 | 6;
  phase: TrendlinePhase;
  quality: "stronger" | "weaker";
  supportPrice: number;
  channelTarget: number | null;
  channelWidth: number | null;
  higherHighs: boolean | null;
  anchorStartDate: string | null;
  anchorEndDate: string | null;
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
  distancePct: number,
  volatilityPct: number,
  lows: Array<number | null>,
  supportAt: (index: number) => number,
): TrendlinePhase | null {
  const currentIndex = lows.length - 1;
  const recentLows = lows.slice(-5);
  const recentStart = currentIndex - recentLows.length + 1;
  const recentDistances = recentLows.map((low, offset) => {
    if (!isPositive(low)) {
      return null;
    }
    const index = recentStart + offset;
    return {
      low,
      distance: low / supportAt(index) - 1,
    };
  });
  const recentlyTouched = recentDistances.some((item) => {
    if (item === null) {
      return false;
    }
    const recoveryPct = (stock.close - item.low) / stock.close;
    return (
      item.distance >= -volatilityPct * TRENDLINE_BOUNCE_TOUCH_ATR &&
      item.distance <= volatilityPct * TRENDLINE_BOUNCE_TOUCH_ATR &&
      recoveryPct >= volatilityPct * TRENDLINE_BOUNCE_RECOVERY_ATR
    );
  });
  if (recentlyTouched) {
    if (
      distancePct > volatilityPct * TRENDLINE_ON_LINE_ATR &&
      distancePct <= volatilityPct * TRENDLINE_BOUNCE_MAX_DISTANCE_ATR
    ) {
      return "bounced";
    }
  }

  if (
    distancePct >= 0 &&
    distancePct <= volatilityPct * TRENDLINE_ON_LINE_ATR
  ) {
    return "on_line";
  }
  if (
    distancePct > volatilityPct * TRENDLINE_ON_LINE_ATR &&
    distancePct <= volatilityPct * TRENDLINE_MAX_DISTANCE_ATR &&
    stock.weekReturn !== null &&
    stock.weekReturn < 0
  ) {
    return "approaching";
  }
  return null;
}

function isPositive(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0;
}

function pivots(
  values: Array<number | null>,
  kind: "low" | "high" = "low",
): Pivot[] {
  const found: Pivot[] = [];
  const radius = TRENDLINE_PIVOT_RADIUS;
  // Allow the first/last point of a lookback to become a pivot when it has at
  // least one observation on both sides. This catches recent tests without
  // waiting two extra sessions for a fully centered pivot window.
  for (let index = 1; index < values.length - 1; index += 1) {
    const price = values[index];
    if (!isPositive(price)) {
      continue;
    }
    const rawNeighbors = values.slice(
      Math.max(0, index - radius),
      Math.min(values.length, index + radius + 1),
    );
    const neighbors = rawNeighbors.filter(isPositive);
    if (neighbors.length !== rawNeighbors.length) {
      continue;
    }
    const isExtreme = kind === "low"
      ? neighbors.every((value) => price <= value) &&
        neighbors.some((value) => price < value)
      : neighbors.every((value) => price >= value) &&
        neighbors.some((value) => price > value);
    if (
      isExtreme
    ) {
      const previous = found.at(-1);
      const equalExtreme = previous &&
        Math.abs(previous.price - price) <= Math.max(price, previous.price) * 1e-6;
      if (equalExtreme && index - previous.index <= radius * 2) {
        // Treat a flat extreme as one pivot, anchored at its last bar.
        found[found.length - 1] = { index, price };
      } else {
        found.push({ index, price });
      }
    }
  }
  return found;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function setupFor(
  stock: Stock,
  lookback: (typeof TRENDLINE_LOOKBACKS)[number],
): TrendlineSetup | null {
  const history = stock.recentLows;
  const lows = history && history.length >= lookback.sessions
    ? history.slice(-lookback.sessions)
    : null;
  const dates = stock.recentLowDates?.slice(-lookback.sessions) ?? [];
  const historyHighs = stock.recentHighs;
  const highs = historyHighs && historyHighs.length >= lookback.sessions
    ? historyHighs.slice(-lookback.sessions)
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

  const points = [...lows, isPositive(stock.low) ? stock.low : null];
  const lowsWithIndex = points.map((price, index) => ({ price, index }));
  const validLows = lowsWithIndex.filter(
    (point): point is { price: number; index: number } => isPositive(point.price),
  );
  const turningPoints = pivots(points, "low");
  const highPoints = highs
    ? [...highs, isPositive(stock.high) ? stock.high : null]
    : null;
  const highTurningPoints = highPoints ? pivots(highPoints, "high") : [];
  const latestHighPivots = highTurningPoints.slice(-3);
  const higherHighs = latestHighPivots.length < 3
    ? null
    : latestHighPivots[2].price > latestHighPivots[1].price &&
      latestHighPivots[1].price > latestHighPivots[0].price;
  if (validLows.length < 10 || turningPoints.length < 2) {
    return null;
  }
  const historicalPivots = turningPoints.filter(
    (point) => point.index < lows.length,
  );
  if (historicalPivots.length < 2) {
    return null;
  }
  const latestPivot = historicalPivots[historicalPivots.length - 1];
  const previousPivot = historicalPivots[historicalPivots.length - 2];
  // A line must terminate at the latest confirmed swing low, and that low
  // must be higher than the prior swing low. This prevents re-anchoring a
  // long-lookback line below a previously broken uptrend.
  if (latestPivot.price <= previousPivot.price) {
    return null;
  }

  const tolerance = stock.close * volatilityPct * 0.75;
  const possible: TrendlineSetup[] = [];
  for (let first = 0; first < turningPoints.length - 1; first += 1) {
    for (let second = first + 1; second < turningPoints.length; second += 1) {
      const older = turningPoints[first];
      const newer = turningPoints[second];
      if (newer.index !== latestPivot.index) {
        continue;
      }
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
      const currentIndex = points.length - 1;
      const supportPrice = valueAt(currentIndex);
      const channelOffsets = highTurningPoints
        .filter((point) => point.index >= older.index && point.index < lows.length)
        .map((point) => point.price - valueAt(point.index))
        .filter((offset) => offset > 0);
      const channelWidth = higherHighs === true && channelOffsets.length >= 2
        ? median(channelOffsets)
        : null;
      const estimatedChannelTarget = channelWidth === null
        ? null
        : supportPrice + channelWidth;
      const channelTarget = estimatedChannelTarget !== null &&
          estimatedChannelTarget > stock.close
        ? estimatedChannelTarget
        : null;
      const distancePct = stock.close / supportPrice - 1;
      const phase = classifyPhase(
        stock,
        distancePct,
        volatilityPct,
        points,
        valueAt,
      );
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
        channelTarget,
        channelWidth,
        higherHighs,
        anchorStartDate: dates[older.index] ?? null,
        anchorEndDate: dates[newer.index] ?? null,
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

/** Finds liquid, higher-volatility Oslo shares approaching rising 1-, 3-, or 6-month support lines. */
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
