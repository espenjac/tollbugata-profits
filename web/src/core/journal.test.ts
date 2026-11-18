import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./config";
import {
  holdingPlan,
  summarizeJournal,
  tradingDaysHeld,
  type Holding,
  type JournalState,
} from "./journal";

const CONFIG = DEFAULT_SETTINGS.trade;

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    ticker: "TEST",
    quantity: 50,
    costBasis: 5029,
    averageCost: 100.58,
    openedAt: null,
    ...overrides,
  };
}

describe("holdingPlan", () => {
  it("sets swing sell levels from the actual average cost", () => {
    const plan = holdingPlan(holding(), CONFIG);

    expect(plan).not.toBeNull();
    expect(plan?.targetPrice).toBeCloseTo(100.58 * 1.09);
    expect(plan?.stopPrice).toBeCloseTo(100.58 * 0.95);
    expect(plan?.maxHoldingDays).toBe(5);
  });

  it("calculates net target after sell fee and cost basis", () => {
    const plan = holdingPlan(holding(), CONFIG);

    expect(plan?.targetNet).toBeCloseTo(
      50 * 100.58 * 1.09 - 5029 - CONFIG.sellFee,
    );
    expect(plan?.targetNet).toBeGreaterThan(0);
  });

  it("revises a near target after three stagnant trading days", () => {
    const plan = holdingPlan(
      holding({ openedAt: "2026-11-03T09:30:00+01:00" }),
      CONFIG,
      { currentPrice: 108.5, dayReturn: 0 },
      new Date("2026-11-05T12:00:00+01:00"),
    );

    expect(plan?.targetRevised).toBe(true);
    expect(plan?.targetPrice).toBeCloseTo(100.58 * 1.081);
    expect(plan?.targetNet).toBeCloseTo(
      50 * (plan?.targetPrice ?? 0) - 5029 - CONFIG.sellFee,
    );
  });

  it("keeps the original target when the move is not stagnant or near enough", () => {
    const openedAt = "2026-11-03T09:30:00+01:00";
    const now = new Date("2026-11-05T12:00:00+01:00");
    const rising = holdingPlan(
      holding({ openedAt }),
      CONFIG,
      { currentPrice: 108.5, dayReturn: 0.01 },
      now,
    );
    const farFromTarget = holdingPlan(
      holding({ openedAt }),
      CONFIG,
      { currentPrice: 106, dayReturn: 0 },
      now,
    );

    expect(rising?.targetRevised).toBe(false);
    expect(farFromTarget?.targetRevised).toBe(false);
  });

  it("has no plan for an empty or short position", () => {
    expect(holdingPlan(holding({ quantity: 0 }), CONFIG)).toBeNull();
    expect(holdingPlan(holding({ averageCost: null }), CONFIG)).toBeNull();
  });
});

describe("summarizeJournal", () => {
  it("tracks the first buy as the position opening time", () => {
    const state: JournalState = {
      startingCash: 5000,
      adjustments: [],
      updatedAt: "2026-10-30T09:00:00+01:00",
      trades: [
        {
          id: "buy-1",
          executedAt: "2026-10-30T09:00:00+01:00",
          registeredAt: "2026-10-30T09:01:00+01:00",
          ticker: "TEST",
          side: "buy",
          quantity: 10,
          price: 100,
          fee: 29,
          note: "",
          editedAt: null,
        },
      ],
    };

    const summary = summarizeJournal(state);

    expect(summary.holdings).toHaveLength(1);
    expect(summary.holdings[0].openedAt).toBe(
      "2026-10-30T09:00:00+01:00",
    );
  });
});

describe("tradingDaysHeld", () => {
  it("counts trading days including the buy day", () => {
    const held = tradingDaysHeld(
      "2026-10-30T13:00:00+02:00",
      new Date("2026-11-02T13:00:00+01:00"),
    );

    expect(held).toBe(2);
  });

  it("does not count Oslo Børs holidays as holding days", () => {
    expect(
      tradingDaysHeld(
        "2026-12-23T10:00:00+01:00",
        new Date("2026-12-28T10:00:00+01:00"),
      ),
    ).toBe(2);
  });

  it("returns null when the opening time is unknown", () => {
    expect(tradingDaysHeld(null)).toBeNull();
  });
});
