// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SimulatorData } from "../lib/api";
import { SimulatorPage } from "./SimulatorPage";

const mockState = vi.hoisted(() => ({
  data: null as SimulatorData | null,
  error: null as string | null,
}));

vi.mock("../lib/useSimulator", () => ({
  useSimulator: () => ({
    data: mockState.data,
    loading: false,
    refreshing: false,
    error: mockState.error,
    loadedAt: new Date("2026-11-05T10:00:00+01:00"),
    refresh: async () => {},
  }),
}));

function makeData(): SimulatorData {
  return {
    portfolios: [
      {
        mode: "swing",
        startingCash: 5_000,
        cash: 2_000,
        position: {
          ticker: "TEST",
          shares: 30,
          originalShares: 30,
          entryPrice: 100,
          entryFee: 29,
          entryAt: "2026-11-05T09:30:00.000Z",
          stopPrice: 95,
          stopPct: 0.05,
          targetPrice: 110,
          targets: [],
          stage: 0,
          highestPrice: 102,
          lastPrice: 102,
          maxHoldingDays: 5,
          reason: "Swing: TEST – momentum; Uke +5 %, måned +10 %",
        },
        pending: null,
        updatedAt: new Date("2026-11-05T10:00:00+01:00"),
      },
      {
        mode: "etrade",
        startingCash: 5_000,
        cash: 5_000,
        position: null,
        pending: {
          ticker: "OET",
          shares: 45,
          trigger: 101,
          invalidation: 99.5,
          stopPrice: 98,
          stopPct: 0.03,
          targetPrice: null,
          targets: [],
          maxHoldingDays: 3,
          score: 72,
          createdAt: "2026-11-05T09:40:00.000Z",
          reason: "Etrade: OET – Breakout; Uke +6 %, RSI 61",
        },
        updatedAt: new Date("2026-11-05T10:00:00+01:00"),
      },
      {
        mode: "trend",
        startingCash: 5_000,
        cash: 29,
        position: null,
        pending: null,
        updatedAt: new Date("2026-11-05T10:00:00+01:00"),
      },
    ],
    trades: [
      {
        id: 2,
        mode: "swing",
        ticker: "TEST",
        side: "sell",
        quantity: 10,
        price: 108,
        fee: 29,
        realizedPnl: 51,
        reason: "Swing: TEST – Momentum",
        executedAt: "2026-11-05T09:50:00.000Z",
      },
      {
        id: 1,
        mode: "etrade",
        ticker: "OET",
        side: "buy",
        quantity: 45,
        price: 100,
        fee: 29,
        realizedPnl: null,
        reason: "Etrade: OET – Breakout (score 72); Uke +6 %, Dag +2 % (trigger)",
        executedAt: "2026-11-05T09:45:00.000Z",
      },
      {
        id: 3,
        mode: "trend",
        ticker: "TREND",
        side: "buy",
        quantity: 49,
        price: 100,
        fee: 29,
        realizedPnl: null,
        reason: "Trend: TREND – SMA20 over SMA50; uke +5 %, måned +12 %, kvartal +25 %",
        executedAt: "2026-11-05T09:55:00.000Z",
      },
    ],
    equity: [
      {
        mode: "swing",
        day: "2026-11-04",
        cash: 5_000,
        positionValue: 0,
        equity: 5_000,
        benchmark: 2050,
        recordedAt: new Date("2026-11-04T15:00:00+01:00"),
      },
      {
        mode: "etrade",
        day: "2026-11-04",
        cash: 5_000,
        positionValue: 0,
        equity: 5_000,
        benchmark: 2050,
        recordedAt: new Date("2026-11-04T15:00:00+01:00"),
      },
      {
        mode: "trend",
        day: "2026-11-04",
        cash: 5_000,
        positionValue: 0,
        equity: 5_000,
        benchmark: 2050,
        recordedAt: new Date("2026-11-04T15:00:00+01:00"),
      },
      {
        mode: "swing",
        day: "2026-11-05",
        cash: 2_000,
        positionValue: 3_060,
        equity: 5_060,
        benchmark: 2055,
        recordedAt: new Date("2026-11-05T10:00:00+01:00"),
      },
      {
        mode: "etrade",
        day: "2026-11-05",
        cash: 5_000,
        positionValue: 0,
        equity: 5_000,
        benchmark: 2055,
        recordedAt: new Date("2026-11-05T10:00:00+01:00"),
      },
      {
        mode: "trend",
        day: "2026-11-05",
        cash: 29,
        positionValue: 4_900,
        equity: 4_929,
        benchmark: 2055,
        recordedAt: new Date("2026-11-05T10:00:00+01:00"),
      },
    ],
  };
}

describe("SimulatorPage", () => {
  it("shows both portfolios, the graph and each mode's trades", () => {
    mockState.data = makeData();
    mockState.error = null;
    const { container } = render(<SimulatorPage />);
    const text = container.textContent ?? "";

    expect(text).toContain("Simulator");
    expect(text).toContain("Swing");
    expect(text).toContain("Etrade");
    expect(text).toContain("Trend");
    expect(text).toContain("Utvikling");
    expect(text).toContain("OSEBX");
    expect(text).toContain("Kjøp og salg");
    expect(text).toContain("TEST");
    expect(text).toContain("Venter på trigger");
    expect(text).toContain("OET over");
    expect(text).toContain("Swing: TEST – Momentum");
    expect(text).toContain("Kjøpsgrunn: Swing: TEST – momentum");
    expect(
      container.querySelector('a[href="https://www.nordnet.no/aksjer/kurser/test-xosl"]'),
    ).toBeTruthy();

    expect(screen.getByRole("tab", { name: /Etrade/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Etrade/ }));

    expect(container.textContent).toContain("Etrade: OET – Breakout");
    expect(container.textContent).toContain("Planlagt kjøpsgrunn: Etrade: OET");
    expect(container.textContent).not.toContain("Swing: TEST – Momentum");
    const purchaseReason = screen.getByText("Vis kjøpsbegrunnelse");
    const disclosure = purchaseReason.closest("details");
    expect(disclosure?.open).toBe(false);
    fireEvent.click(purchaseReason);
    expect(disclosure?.open).toBe(true);
    expect(disclosure?.textContent).toContain("Uke +6 %, Dag +2 %");

    fireEvent.click(screen.getByRole("tab", { name: /Trend/ }));
    expect(container.textContent).toContain("Trend: TREND – SMA20 over SMA50");
    expect(
      screen.getByRole("tabpanel", { name: "Trend" }).textContent,
    ).not.toContain("Etrade: OET – Breakout");
  });

  it("explains the empty state before the first tick", () => {
    mockState.data = {
      portfolios: [],
      trades: [],
      equity: [],
    };
    mockState.error = null;
    const { container } = render(<SimulatorPage />);
    const text = container.textContent ?? "";

    expect(text).toContain("Ingen simulerte tick ennå");
    expect(text).toContain("0003_simulator.sql");
    expect(text).toContain("Ingen handler ennå");
  });

  it("shows a load error with a retry button", () => {
    mockState.data = null;
    mockState.error = "Kunne ikke lese simulatoren: tabellen finnes ikke";
    render(<SimulatorPage />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Kunne ikke laste simulatoren",
    );
    expect(screen.getByRole("button", { name: "Prøv igjen" })).toBeTruthy();
  });
});
