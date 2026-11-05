// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../core/config";
import { parseScannerPayload } from "../core/market";
import { parseNewsPayload } from "../core/news";
import { buildMarketReport } from "../core/report";
import { DEFAULT_CRITERIA, screen } from "../core/screen";
import type { JournalState } from "../core/journal";
import type { Universe } from "../core/types";
import growthFixture from "../core/__fixtures__/growth.json";
import newsFixture from "../core/__fixtures__/news.json";
import scanFixture from "../core/__fixtures__/scan.json";
import { DashboardPage } from "./DashboardPage";

const mockState = vi.hoisted(() => ({
  report: null as unknown,
  snapshot: null as unknown,
  history: [] as unknown[],
  settings: null as unknown,
  journal: null as unknown,
}));

vi.mock("../lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "00000000-0000-0000-0000-000000000001", email: "eier@example.com" },
    session: null,
    loading: false,
    configured: true,
    signInWithGoogle: async () => {},
    signOut: async () => {},
  }),
}));

vi.mock("../lib/api", () => ({
  todayDate: () => "2026-11-01",
  loadSettings: async () => mockState.settings,
  loadJournal: async () => mockState.journal,
  loadReportHistory: async () => mockState.history,
  loadReportByDate: async () => mockState.report,
  loadReportById: async () => mockState.report,
  fetchMarketSnapshot: async () => mockState.snapshot,
  saveReport: async () => mockState.report,
}));

function makeUniverse(): Universe {
  const growthTickers = new Set<string>(growthFixture.tickers as string[]);
  return {
    stocks: parseScannerPayload(scanFixture, growthTickers),
    fetchedAt: new Date("2026-11-01T13:50:00+01:00"),
    source: "live",
    warning: null,
    growthTickers,
    growthSource: "live",
    growthWarning: null,
  };
}

function makeData() {
  const universe = makeUniverse();
  const result = screen(universe.stocks, DEFAULT_CRITERIA);
  const news = parseNewsPayload(
    newsFixture,
    new Date("2026-10-30T16:30:00+01:00"),
    new Date("2026-11-01T14:07:00+01:00"),
    "live",
  );
  const report = buildMarketReport(
    result.matches,
    DEFAULT_CRITERIA,
    universe,
    news,
    DEFAULT_SETTINGS,
    "2026-11-01",
    new Date("2026-11-01T14:07:00+01:00"),
  );
  const journal: JournalState = {
    startingCash: 5000,
    trades: [],
    adjustments: [],
    updatedAt: "2026-11-01T14:07:00+01:00",
  };
  return { universe, result, news, report, journal };
}

describe("DashboardPage", () => {
  it("renders a saved report, filters, news, stock table and history", async () => {
    const data = makeData();
    mockState.report = data.report;
    mockState.snapshot = {
      universe: data.universe,
      news: data.news,
      generatedAt: new Date("2026-11-01T14:07:00+01:00"),
    };
    mockState.settings = DEFAULT_SETTINGS;
    mockState.journal = data.journal;
    mockState.history = [
      {
        id: "report-1",
        date: "2026-11-01",
        generatedAt: new Date("2026-11-01T14:07:00+01:00"),
        mainTicker: data.report.main?.candidate.stock.ticker ?? null,
        mainScore: data.report.main?.candidate.score ?? null,
        noTrade: data.report.main === null,
      },
    ];

    const { container } = render(<DashboardPage />);
    await waitFor(() => {
      expect(container.textContent).toContain("Dagens hovedkandidat");
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Dagens rapport");
    expect(text).toContain("Swing 2–5 dager");
    expect(text).toContain(data.report.main?.candidate.stock.ticker ?? "");
    expect(text).toContain("Filtre");
    expect(text).toContain("Børsmeldinger");
    expect(text).toContain("Rapporthistorikk");
    expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
  });
});
