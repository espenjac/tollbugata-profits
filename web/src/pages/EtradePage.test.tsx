// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../core/config";
import { buildEtradeReport } from "../core/etrade";
import type { Stock, Universe } from "../core/types";
import { EtradePage } from "./EtradePage";

const mockState = vi.hoisted(() => ({
  report: null as unknown,
}));

vi.mock("../lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "eier@example.com",
    },
    session: null,
    loading: false,
    configured: true,
    signInWithGoogle: async () => {},
    signOut: async () => {},
  }),
}));

vi.mock("../lib/useEtrade", () => ({
  useEtrade: () => ({
    snapshot: null,
    report: mockState.report,
    settings: DEFAULT_SETTINGS,
    loading: false,
    refreshing: false,
    error: null,
    warning: null,
    notice: null,
    refresh: async () => {},
  }),
}));

function makeStock(overrides: Partial<Stock> = {}): Stock {
  return {
    ticker: "TEST",
    name: "Test ASA",
    close: 100,
    currency: "NOK",
    weekReturn: 0.05,
    monthReturn: 0.1,
    quarterReturn: 0.15,
    sma5: 98,
    sma20: 95,
    sma50: 90,
    rsi: 60,
    ath: 120,
    high52w: 120,
    marketCap: 1_000_000_000,
    volume: 1_000_000,
    sector: "Teknologi",
    instrumentType: "stock",
    market: "oslo",
    earningsDate: null,
    exDividendDate: null,
    averageVolume10d: 800_000,
    atr: 3,
    dayReturn: 0.01,
    open: 100,
    high: 101,
    low: 98,
    vwap: 100.5,
    ...overrides,
  };
}

function makeUniverse(stocks: Stock[]): Universe {
  return {
    stocks,
    fetchedAt: new Date("2026-11-05T10:00:00+01:00"),
    source: "live",
    warning: null,
    growthTickers: new Set(),
    growthSource: "live",
    growthWarning: null,
  };
}

function makeReport(stocks: Stock[]) {
  return buildEtradeReport(
    stocks,
    makeUniverse(stocks),
    null,
    DEFAULT_SETTINGS,
    "2026-11-05",
    new Date("2026-11-05T10:00:00+01:00"),
  );
}

describe("EtradePage", () => {
  it("renders a fresh idea with trigger, stop, targets and plan rules", () => {
    mockState.report = makeReport([makeStock()]);
    const { container } = render(<EtradePage />);
    const text = container.textContent ?? "";

    expect(text).toContain("Etrade-modus");
    expect(text).toContain("Dagens Etrade-ideer");
    expect(text).toContain("TEST");
    expect(text).toContain("Kjøp over");
    expect(text).toContain("Stopp");
    expect(text).toContain("T1");
    expect(text).toContain("T2");
    expect(text).toContain("T3");
    expect(text).toContain("Plan – observer – utfør:");
    expect(text).toContain("long only");
    expect(text).toContain("Slik brukes Etrade-modus");
  });

  it("shows watchlist ideas with the blocking reason", () => {
    mockState.report = makeReport([makeStock({ rsi: 80 })]);
    const { container } = render(<EtradePage />);
    const text = container.textContent ?? "";

    expect(text).toContain("Ingen Etrade-ideer akkurat nå");
    expect(text).toContain("På radaren (1)");
    expect(text).toContain("RSI over 75");
  });
});
