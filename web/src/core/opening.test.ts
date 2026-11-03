import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./config";
import { buildEntryZone, buildOpeningPlan, marketPhase } from "./opening";
import { buildTradePlan } from "./trade";
import {
  emptyNewsSignal,
  type PlannedCandidate,
  type Stock,
} from "./types";

const CONFIG = DEFAULT_SETTINGS.trade;

function stock(overrides: Partial<Stock> = {}): Stock {
  return {
    ticker: "TEST",
    name: "Test AS",
    close: 100,
    currency: "NOK",
    weekReturn: 0.05,
    monthReturn: 0.08,
    quarterReturn: 0.1,
    sma5: 99,
    sma20: 96,
    sma50: 94,
    rsi: 60,
    ath: 110,
    high52w: 108,
    marketCap: 1_000_000_000,
    volume: 100_000,
    sector: "Test",
    instrumentType: "stock",
    market: "oslo",
    earningsDate: null,
    exDividendDate: null,
    averageVolume10d: 120_000,
    atr: 2,
    dayReturn: 0.01,
    open: null,
    high: null,
    low: null,
    vwap: null,
    ...overrides,
  };
}

function planned(): PlannedCandidate {
  return {
    candidate: {
      stock: stock(),
      score: 70,
      reasons: [],
      warnings: [],
      opportunityScore: 65,
      riskScore: 25,
      categories: ["momentum"],
      newsSignal: emptyNewsSignal(),
      breakoutStatus: "ikke nær",
      technicalUpside: 0.05,
      resistance: 105,
      support: 95,
      volumeRatio: 1.2,
    },
    trade: buildTradePlan(100, CONFIG),
    recommendable: true,
    blockReasons: [],
  };
}

function quote(overrides: Partial<Stock> = {}): Stock {
  return stock({
    open: 103,
    high: 104,
    low: 102,
    vwap: 102.8,
    close: 103.5,
    ...overrides,
  });
}

function at(hour: number, minute = 0): Date {
  return new Date(
    `2026-11-03T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+01:00`,
  );
}

describe("marketPhase", () => {
  it("separates pre-open, opening auction, open and closed", () => {
    expect(marketPhase(at(8, 30))).toBe("pre");
    expect(marketPhase(at(9, 5))).toBe("opening");
    expect(marketPhase(at(9, 15))).toBe("open");
    expect(marketPhase(at(16, 30))).toBe("open");
    expect(marketPhase(at(17))).toBe("closed");
  });

  it("treats weekends as closed", () => {
    expect(marketPhase(new Date("2026-11-07T10:00:00+01:00"))).toBe("closed");
  });
});

describe("buildEntryZone", () => {
  it("uses half ATR inside the plan stop and target", () => {
    const zone = buildEntryZone(planned());

    expect(zone.low).toBe(99);
    expect(zone.high).toBe(101);
    expect(zone.widthPct).toBeCloseTo(0.02);
    expect(zone.valid).toBe(true);
  });

  it("caps the zone at the plan stop and target when ATR is large", () => {
    const candidate = planned();
    candidate.candidate.stock.atr = 10;

    const zone = buildEntryZone(candidate);

    expect(zone.low).toBe(98);
    expect(zone.high).toBe(102);
  });

  it("falls back to half the plan distance without ATR", () => {
    const candidate = planned();
    candidate.candidate.stock.atr = null;

    const zone = buildEntryZone(candidate);

    expect(zone.low).toBe(99);
    expect(zone.high).toBe(101);
  });

  it("is invalid when the trade plan has no usable bounds", () => {
    const candidate = planned();
    candidate.trade = buildTradePlan(0, CONFIG);

    expect(buildEntryZone(candidate).valid).toBe(false);
  });
});

describe("buildOpeningPlan", () => {
  it("recalculates stop and target from the actual opening price", () => {
    const plan = buildOpeningPlan(planned(), quote(), CONFIG, at(9, 30));

    expect(plan.openingPrice).toBe(103);
    expect(plan.gapPct).toBeCloseTo(0.03);
    expect(plan.newPlan?.targetPrice).toBeCloseTo(105.06);
    expect(plan.newPlan?.stopPrice).toBeCloseTo(100.94);
    expect(plan.oldTarget).toBe(102);
    expect(plan.oldStop).toBe(98);
    expect(plan.entryZone.low).toBe(99);
    expect(plan.entryZone.high).toBe(101);
    expect(plan.zoneStatus).toBe("above");
    expect(plan.status).toBe("over-sone");
  });

  it("marks an opening inside the zone and above VWAP as ready", () => {
    const plan = buildOpeningPlan(
      planned(),
      quote({
        open: 100.5,
        close: 100.6,
        high: 100.7,
        low: 100.2,
        vwap: 100.2,
      }),
      CONFIG,
      at(9, 30),
    );

    expect(plan.zoneStatus).toBe("inside");
    expect(plan.status).toBe("klar");
  });

  it("marks a gap-up that is below VWAP as wait", () => {
    const plan = buildOpeningPlan(
      planned(),
      quote({
        open: 100.5,
        close: 100.2,
        high: 100.7,
        low: 100.1,
        vwap: 100.8,
      }),
      CONFIG,
      at(9, 30),
    );
    expect(plan.zoneStatus).toBe("inside");
    expect(plan.status).toBe("vent");
    expect(plan.statusText).toBe("Under VWAP");
  });

  it("marks a break below the buy zone as under-sone", () => {
    const plan = buildOpeningPlan(
      planned(),
      quote({ open: 97, close: 97, high: 97.5, low: 96.8, vwap: 97.2 }),
      CONFIG,
      at(9, 30),
    );
    expect(plan.zoneStatus).toBe("below");
    expect(plan.status).toBe("under-sone");
  });

  it("keeps over-sone when the opening was above the zone", () => {
    const plan = buildOpeningPlan(
      planned(),
      quote({ open: 103, close: 100.5, high: 103.5, low: 100.2, vwap: 100.3 }),
      CONFIG,
      at(9, 30),
    );

    expect(plan.zoneStatus).toBe("above");
    expect(plan.currentZoneStatus).toBe("inside");
    expect(plan.status).toBe("over-sone");
  });

  it("marks a break of the new stop and a hit of the new target", () => {
    const stopped = buildOpeningPlan(
      planned(),
      quote({
        open: 100.5,
        close: 98.2,
        high: 100.7,
        low: 98,
        vwap: 99,
      }),
      CONFIG,
      at(9, 30),
    );
    const target = buildOpeningPlan(
      planned(),
      quote({
        open: 100.5,
        close: 102.6,
        high: 102.7,
        low: 100.2,
        vwap: 101,
      }),
      CONFIG,
      at(9, 30),
    );

    expect(stopped.status).toBe("stoppet");
    expect(target.status).toBe("target");
  });

  it("does not publish a plan during the first quarter", () => {
    const plan = buildOpeningPlan(planned(), quote(), CONFIG, at(9, 5));
    expect(plan.status).toBe("vent");
    expect(plan.statusText).toContain("Første kvarter");
  });

  it("waits before the open and flags missing opening data afterwards", () => {
    const before = buildOpeningPlan(
      planned(),
      quote({ open: null }),
      CONFIG,
      at(8, 30),
    );
    const after = buildOpeningPlan(
      planned(),
      quote({ open: null }),
      CONFIG,
      at(9, 30),
    );

    expect(before.status).toBe("for-tidlig");
    expect(after.status).toBe("ugyldig");
  });
});
