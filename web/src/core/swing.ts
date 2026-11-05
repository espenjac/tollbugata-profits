import type { TradeConfig, TradeMode } from "./config";
import { osloParts } from "./dates";

export const SWING_MAX_HOLDING_DAYS = 5;
export const SWING_ATR_STOP_MULTIPLIER = 1.2;
export const SWING_MIN_STOP_PCT = 0.04;
export const SWING_MAX_STOP_PCT = 0.06;
export const SWING_TARGET_STOP_MULTIPLE = 1.8;
export const SWING_MIN_TARGET_PCT = 0.08;
export const SWING_MAX_TARGET_PCT = 0.1;

export interface TradeLevels {
  mode: TradeMode;
  targetPct: number;
  stopPct: number;
  maxHoldingDays: number;
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
    "Helgeflagg: Fredag i dag. Vurder å selge før stengetid hvis du vil " +
    "unngå gaprisiko over helgen, og vær ekstra forsiktig med nye kjøp sent " +
    "på fredag. La sterke posisjoner løpe hvis stopen og planen tilsier det."
  );
}
