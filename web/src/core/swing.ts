import type { TradeConfig, TradeMode } from "./config";
import { osloParts } from "./dates";

export const SWING_MAX_HOLDING_DAYS = 5;
export const SWING_ATR_STOP_MULTIPLIER = 1.2;
export const SWING_MIN_STOP_PCT = 0.04;
export const SWING_MAX_STOP_PCT = 0.06;
export const SWING_TARGET_STOP_MULTIPLE = 1.8;
export const SWING_MIN_TARGET_PCT = 0.08;
export const SWING_MAX_TARGET_PCT = 0.1;
export const SWING_TARGET_REVIEW_AFTER_DAYS = 3;
export const SWING_TARGET_REVIEW_PROGRESS = 0.8;
export const SWING_REVISED_TARGET_PROGRESS = 0.9;
export const SWING_STAGNATION_DAY_RETURN = 0.005;

export interface TradeLevels {
  mode: TradeMode;
  targetPct: number;
  stopPct: number;
  maxHoldingDays: number;
}

/**
 * Reassess a swing target once the position is at least 80% of the way to its
 * original target, has been held for three sessions, and is no longer moving
 * meaningfully higher that day. The revised target preserves 90% of the
 * originally planned price gain; it never widens the target.
 */
export function reassessedSwingTarget(input: {
  entryPrice: number;
  targetPrice: number;
  currentPrice: number;
  dayReturn: number | null;
  heldDays: number | null;
}): number | null {
  const { entryPrice, targetPrice, currentPrice, dayReturn, heldDays } = input;
  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(targetPrice) ||
    !Number.isFinite(currentPrice) ||
    entryPrice <= 0 ||
    targetPrice <= entryPrice ||
    currentPrice <= 0 ||
    dayReturn === null ||
    !Number.isFinite(dayReturn) ||
    heldDays === null ||
    heldDays < SWING_TARGET_REVIEW_AFTER_DAYS ||
    dayReturn > SWING_STAGNATION_DAY_RETURN
  ) {
    return null;
  }

  const plannedGain = targetPrice - entryPrice;
  const progress = (currentPrice - entryPrice) / plannedGain;
  if (progress < SWING_TARGET_REVIEW_PROGRESS) {
    return null;
  }

  return entryPrice + plannedGain * SWING_REVISED_TARGET_PROGRESS;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Swing plans use a stop of roughly 1.2x ATR, bounded to 4-6 %, and a target
 * of 1.8x the stop, bounded to 8-10 %. The bounds keep risk readable for a
 * small account and avoid very tight stops on volatile shares.
 */
export function tradeLevels(
  config: TradeConfig,
  atrPctValue: number | null = null,
): TradeLevels {
  if (config.mode === "day") {
    return {
      mode: "day",
      targetPct: config.targetPct,
      stopPct: config.stopLossPct,
      maxHoldingDays: 1,
    };
  }

  const fallbackStop = clamp(
    config.stopLossPct,
    SWING_MIN_STOP_PCT,
    SWING_MAX_STOP_PCT,
  );
  const atrStop =
    atrPctValue !== null && Number.isFinite(atrPctValue) && atrPctValue > 0
      ? atrPctValue * SWING_ATR_STOP_MULTIPLIER
      : fallbackStop;
  const stopPct = clamp(
    atrStop,
    SWING_MIN_STOP_PCT,
    SWING_MAX_STOP_PCT,
  );
  const targetPct = clamp(
    stopPct * SWING_TARGET_STOP_MULTIPLE,
    SWING_MIN_TARGET_PCT,
    SWING_MAX_TARGET_PCT,
  );

  return {
    mode: "swing",
    targetPct,
    stopPct,
    maxHoldingDays: SWING_MAX_HOLDING_DAYS,
  };
}

/** A Friday reminder, not an automatic sell rule. */
export function weekendFlag(now: Date = new Date()): string | null {
  if (osloParts(now).weekday !== 5) {
    return null;
  }
  return (
    "Helgeflagg: Fredag i dag. Du kan holde posisjonen over helgen, men vær " +
    "oppmerksom på gaprisiko og at nye kjøp sent på fredag kan få en dårligere " +
    "inngang. La stopen og planen styre, ikke klokken."
  );
}
