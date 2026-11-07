import { describe, expect, it } from "vitest";
import {
  easterSunday,
  isOsloMarketHoliday,
  isOsloMarketOpenDay,
} from "./dates";

describe("easterSunday", () => {
  it("matches known Gregorian Easter dates", () => {
    expect(easterSunday(2024)).toEqual({ month: 3, day: 31 });
    expect(easterSunday(2025)).toEqual({ month: 4, day: 20 });
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
  });
});

describe("isOsloMarketHoliday", () => {
  it("marks fixed Norwegian holidays", () => {
    for (const day of [
      "2026-01-01", // New Year's Day
      "2026-05-01", // Labour Day
      "2026-05-17", // Constitution Day
      "2026-12-24", // Christmas Eve
      "2026-12-25", // Christmas Day
      "2026-12-26", // Boxing Day
      "2026-12-31", // New Year's Eve
    ]) {
      expect(isOsloMarketHoliday(day), day).toBe(true);
    }
  });

  it("marks movable feasts relative to Easter", () => {
    for (const day of [
      "2026-04-02", // Maundy Thursday
      "2026-04-03", // Good Friday
      "2026-04-06", // Easter Monday
      "2026-05-14", // Ascension Day
      "2026-05-25", // Whit Monday
    ]) {
      expect(isOsloMarketHoliday(day), day).toBe(true);
    }
  });

  it("does not mark ordinary weekdays", () => {
    expect(isOsloMarketHoliday("2026-05-18")).toBe(false);
    expect(isOsloMarketHoliday("2026-11-04")).toBe(false);
  });
});

describe("isOsloMarketOpenDay", () => {
  it("is closed on weekends", () => {
    expect(isOsloMarketOpenDay("2026-11-07")).toBe(false); // Saturday
    expect(isOsloMarketOpenDay("2026-11-08")).toBe(false); // Sunday
  });

  it("is closed on holidays that fall on weekdays", () => {
    expect(isOsloMarketOpenDay("2026-04-03")).toBe(false);
    expect(isOsloMarketOpenDay("2026-12-24")).toBe(false);
  });

  it("is open on ordinary weekdays", () => {
    expect(isOsloMarketOpenDay("2026-11-04")).toBe(true);
    // 17 May 2026 is a Sunday; Norway does not move the holiday to Monday.
    expect(isOsloMarketOpenDay("2026-05-18")).toBe(true);
  });
});
