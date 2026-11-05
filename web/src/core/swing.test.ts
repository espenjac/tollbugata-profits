import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type TradeConfig } from "./config";
import { tradeLevels, weekendFlag } from "./swing";

const CONFIG = DEFAULT_SETTINGS.trade;

function config(overrides: Partial<TradeConfig> = {}): TradeConfig {
  return { ...CONFIG, ...overrides };
}

describe("tradeLevels", () => {
  it("uses 1.2x ATR for the stop and at least twice the stop as target", () => {
    const levels = tradeLevels(config(), 0.0431);

    expect(levels.mode).toBe("swing");
    expect(levels.stopPct).toBeCloseTo(0.0431 * 1.2);
    expect(levels.targetPct).toBeCloseTo(0.0431 * 1.2 * 1.8);
    expect(levels.maxHoldingDays).toBe(5);
  });

  it("clamps stop to 4-6 % and target to 8-10 %", () => {
    const low = tradeLevels(config(), 0.01);
    const high = tradeLevels(config(), 0.2);

    expect(low.stopPct).toBeCloseTo(0.04);
    expect(low.targetPct).toBeCloseTo(0.08);
    expect(high.stopPct).toBeCloseTo(0.06);
    expect(high.targetPct).toBeCloseTo(0.1);
  });

  it("uses the configured fallback when ATR is missing", () => {
    const levels = tradeLevels(config(), null);

    expect(levels.stopPct).toBeCloseTo(0.05);
    expect(levels.targetPct).toBeCloseTo(0.09);
  });

  it("keeps fixed day-trade levels in day mode", () => {
    const levels = tradeLevels(
      config({ mode: "day", targetPct: 0.05, stopLossPct: 0.02 }),
      0.05,
    );

    expect(levels).toEqual({
      mode: "day",
      targetPct: 0.05,
      stopPct: 0.02,
      maxHoldingDays: 1,
    });
  });
});

describe("weekendFlag", () => {
  it("flags Friday in Oslo time", () => {
    expect(
      weekendFlag(new Date("2026-11-06T10:00:00+01:00")),
    ).toContain("Helgeflagg");
  });

  it("does not flag other weekdays", () => {
    expect(weekendFlag(new Date("2026-11-05T10:00:00+01:00"))).toBeNull();
  });
});
