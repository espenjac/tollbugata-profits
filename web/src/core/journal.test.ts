import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./config";
import { holdingPlan, type Holding } from "./journal";

const CONFIG = DEFAULT_SETTINGS.trade;

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    ticker: "TEST",
    quantity: 50,
    costBasis: 5029,
    averageCost: 100.58,
    ...overrides,
  };
}

describe("holdingPlan", () => {
  it("sets the sell target from the actual average cost", () => {
    const plan = holdingPlan(holding(), CONFIG);

    expect(plan).not.toBeNull();
    expect(plan?.targetPrice).toBeCloseTo(100.58 * 1.05);
    expect(plan?.stopPrice).toBeCloseTo(100.58 * 0.98);
  });

  it("calculates net target after sell fee and cost basis", () => {
    const plan = holdingPlan(holding(), CONFIG);

    expect(plan?.targetNet).toBeCloseTo(
      50 * 100.58 * 1.05 - 5029 - CONFIG.sellFee,
    );
    expect(plan?.targetNet).toBeGreaterThan(0);
  });

  it("has no plan for an empty or short position", () => {
    expect(holdingPlan(holding({ quantity: 0 }), CONFIG)).toBeNull();
    expect(holdingPlan(holding({ averageCost: null }), CONFIG)).toBeNull();
  });
});
