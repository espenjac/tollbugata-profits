// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../core/config";
import { parseScannerPayload } from "../core/market";
import { parseNewsPayload } from "../core/news";
import { buildMarketReport } from "../core/report";
import { DEFAULT_CRITERIA, screen } from "../core/screen";
import type { Universe } from "../core/types";
import growthFixture from "../core/__fixtures__/growth.json";
import newsFixture from "../core/__fixtures__/news.json";
import scanFixture from "../core/__fixtures__/scan.json";
import { ReportView } from "./ReportView";
import { StockTable } from "./StockTable";

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

function makeNews() {
  return parseNewsPayload(
    newsFixture,
    new Date("2026-10-30T16:30:00+01:00"),
    new Date("2026-11-01T14:07:00+01:00"),
    "live",
  );
}

function makeReport() {
  const universe = makeUniverse();
  const result = screen(universe.stocks, DEFAULT_CRITERIA);
  const news = makeNews();
  const report = buildMarketReport(
    result.matches,
    DEFAULT_CRITERIA,
    universe,
    news,
    DEFAULT_SETTINGS,
    "2026-11-01",
    new Date("2026-11-01T14:07:00+01:00"),
  );
  return { report, result, news };
}

describe("dashboard components", () => {
  it("renders the main candidate, alternatives and blocked candidates", () => {
    const { report, news } = makeReport();
    const { container } = render(
      <MemoryRouter>
        <ReportView report={report} news={news} />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Dagens hovedkandidat");
    expect(text).toContain(report.main?.candidate.stock.ticker ?? "");
    expect(text).toContain(`Anbefalte alternativer (${report.alternatives.length})`);
    expect(text).toContain(`Ikke anbefalte kandidater (${report.blocked.length})`);
    expect(text).toContain("Gevinst- og tapsscenarioer");
    expect(text).toContain("SWING");
    expect(text).toContain("Swingrapport · 2–5 dager");
    expect(text).toContain("Swingplan:");
    expect(text).toContain("Rapporten utfører ingen");
    expect(report.main?.trade.mode).toBe("swing");
    expect(report.main?.trade.maxHoldingDays).toBe(5);
    expect(report.main?.trade.stopPct).toBeGreaterThanOrEqual(0.04);
    expect(report.main?.trade.stopPct).toBeLessThanOrEqual(0.06);
    expect(report.main?.trade.targetPct).toBeGreaterThanOrEqual(0.08);
    expect(report.main?.trade.targetPct).toBeLessThanOrEqual(0.1);
  });

  it("renders the screened stock table with sorting and Nordnet links", () => {
    const { result } = makeReport();
    const { container } = render(
      <StockTable
        stocks={result.matches}
        criteria={DEFAULT_CRITERIA}
        today="2026-11-01"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain(`Treff (${result.matches.length})`);
    expect(text).toContain("Snitt omsetning");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(
      result.matches.length,
    );
    expect(container.querySelectorAll('a[href*="nordnet.no"]').length).toBeGreaterThan(
      0,
    );
  });

  it("renders mobile stock cards in batches", () => {
    const { result } = makeReport();
    const { container } = render(
      <StockTable
        stocks={result.matches}
        criteria={DEFAULT_CRITERIA}
        today="2026-11-01"
      />,
    );
    const cards = () => container.querySelectorAll(".stock-card");
    const firstBatch = Math.min(20, result.matches.length);
    expect(cards()).toHaveLength(firstBatch);

    if (result.matches.length > firstBatch) {
      fireEvent.click(
        container.querySelector<HTMLButtonElement>(".stock-show-more")!,
      );
      expect(cards()).toHaveLength(
        Math.min(firstBatch + 20, result.matches.length),
      );
    }
  });
});
