import { describe, expect, it } from "vitest";
import { fromOsloDate } from "./dates";
import { expectedVolumeShare, timeWeightedVolumeRatio } from "./volume";

// 2026-11-05 is a normal Thursday trading day on Oslo Børs.
const at = (hour: number, minute = 0) =>
  fromOsloDate("2026-11-05", hour, minute);

describe("expectedVolumeShare", () => {
  it("is zero before and at the open and one at the close", () => {
    expect(expectedVolumeShare(at(8, 30))).toBe(0);
    expect(expectedVolumeShare(at(9))).toBe(0);
    expect(expectedVolumeShare(at(16, 30))).toBe(1);
    expect(expectedVolumeShare(at(17))).toBe(1);
  });

  it("follows the U-shaped intraday curve", () => {
    expect(expectedVolumeShare(at(9, 30))).toBeCloseTo(0.13, 5);
    expect(expectedVolumeShare(at(12))).toBeCloseTo(0.43, 5);
    expect(expectedVolumeShare(at(16))).toBeCloseTo(0.88, 5);
  });

  it("treats a closed day as a completed day", () => {
    expect(expectedVolumeShare(fromOsloDate("2026-11-07", 12, 0))).toBe(1);
  });
});

describe("timeWeightedVolumeRatio", () => {
  it("normalises a morning ratio to the expected pace", () => {
    expect(timeWeightedVolumeRatio(0.13, at(9, 30))).toBeCloseTo(1, 5);
    expect(timeWeightedVolumeRatio(0.1, at(9, 30))).toBeCloseTo(0.769, 3);
  });

  it("leaves a completed day unchanged", () => {
    expect(timeWeightedVolumeRatio(0.8, at(16, 30))).toBeCloseTo(0.8, 5);
    expect(timeWeightedVolumeRatio(0.8, at(17))).toBeCloseTo(0.8, 5);
  });

  it("returns null when there is no meaningful pace yet", () => {
    expect(timeWeightedVolumeRatio(0.5, at(8, 30))).toBeNull();
    expect(timeWeightedVolumeRatio(null, at(12))).toBeNull();
    expect(timeWeightedVolumeRatio(Number.NaN, at(12))).toBeNull();
  });
});
