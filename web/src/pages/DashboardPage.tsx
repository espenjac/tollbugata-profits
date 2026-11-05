import { osloDateString } from "../core/dates";
import {
  formatDateTime,
  formatNumber,
  formatPct,
} from "../core/format";
import { describeCriteria, EXCLUSION_LABELS } from "../core/screen";
import type { ScreenResult } from "../core/screen";
import { marketSession, marketSessionLabel } from "../core/session";
import { distanceToAth } from "../core/types";
import { useAuth } from "../lib/auth-context";
import { todayDate } from "../lib/api";
import { useDashboard } from "../lib/useDashboard";
import { Filters } from "../components/Filters";
import { NewsSection } from "../components/NewsSection";
import { ReportHistory } from "../components/ReportHistory";
import { ReportView } from "../components/ReportView";
import { StockTable } from "../components/StockTable";
import {
  ErrorPanel,
  InlineNotice,
  LoadingView,
  StatCard,
} from "../components/ui";

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sourceText(source: string): string {
  const labels: Record<string, string> = {
    live: "live",
    cache: "cache",
    "stale-cache": "gammel cache",
    error: "feil",
    ukjent: "ukjent",
  };
  return labels[source] ?? source;
}

export function DashboardPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const dashboard = useDashboard(userId);
  const {
    snapshot,
    report,
    viewedReport,
    history,
    criteria,
    loading,
    refreshing,
    error,
    warning,
    notice,
    screenResult,
    setCriteria,
    refresh,
    viewReport,
    clearViewedReport,
  } = dashboard;

  const today = todayDate();
  const activeReport = viewedReport ?? report;
  const viewingHistorical =
    viewedReport !== null && osloDateString(viewedReport.generatedAt) !== today;
  const stats = computeStats(screenResult);
  const session = marketSession();

  if (loading && !activeReport && !screenResult) {
    return <LoadingView message="Henter markedsdata og bygger rapport …" />;
  }

  if (error && !activeReport && !screenResult) {
    return (
      <ErrorPanel
        title="Kunne ikke laste markedet"
        message={error}
        onRetry={() => void refresh()}
      />
    );
  }

  return (
    <div className="page dashboard-page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            Oslo Børs · {marketSessionLabel(session)} · Swing 2–5 dager
          </p>
          <h1>Dagens rapport</h1>
          <p>
            Én swingplan med 2–5 handledagers horisont, bygget på nytt fra
            ferskeste kurs, teknisk score og nyheter hver gang du åpner eller
            oppdaterer.
          </p>
          <div className="hero-meta">
            {snapshot ? (
              <>
                <span>
                  Kurs hentet {formatDateTime(snapshot.universe.fetchedAt)} (
                  {sourceText(snapshot.universe.source)})
                </span>
                <span>
                  Nyheter {formatDateTime(snapshot.news.fetchedAt)} (
                  {sourceText(snapshot.news.source)})
                </span>
              </>
            ) : (
              <span>Markedsdata er ikke tilgjengelig i denne økten.</span>
            )}
          </div>
        </div>
        <div className="hero-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? "Oppdaterer …" : "Oppdater med siste kurs"}
          </button>
          <small>
            {today} · rapporten erstattes med en ny vurdering hver gang du
            oppdaterer.
          </small>
        </div>
      </section>

      {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {warning ? <InlineNotice kind="warning">{warning}</InlineNotice> : null}
      {notice ? <InlineNotice kind="success">{notice}</InlineNotice> : null}

      {activeReport ? (
        <ReportView
          report={activeReport}
          news={viewingHistorical ? null : (snapshot?.news ?? null)}
          historical={viewingHistorical}
          onBack={clearViewedReport}
        />
      ) : (
        <section className="panel">
          <h2>Ingen rapport for i dag</h2>
          <p className="muted">
            Rapporten kunne ikke bygges fordi markedsdata mangler.
          </p>
        </section>
      )}

      {screenResult ? (
        <details className="panel screening-panel">
          <summary>
            <span>Screen hele Oslo Børs</span>
            <small>
              {screenResult.matches.length} treff av {screenResult.universeSize}
            </small>
          </summary>
          <div className="screening-body">
            <section className="stats-grid" aria-label="Nøkkeltall">
              <StatCard
                label="Treff"
                value={screenResult.matches.length}
                hint={`av ${screenResult.universeSize} aksjer`}
              />
              <StatCard
                label="På/ved ATH"
                value={screenResult.atHighCount}
                hint="merket ATH i tabellen"
              />
              <StatCard
                label="Median uke"
                value={
                  stats.medianWeek === null ? "–" : formatPct(stats.medianWeek)
                }
                hint="blant treffene"
                tone={
                  stats.medianWeek === null
                    ? "neutral"
                    : stats.medianWeek >= 0
                      ? "positive"
                      : "negative"
                }
              />
              <StatCard
                label="Median mot ATH"
                value={
                  stats.medianDistance === null
                    ? "–"
                    : formatPct(stats.medianDistance)
                }
                hint="nærmeste kjente topp"
              />
            </section>

            <div className="criteria-panel">
              <div>
                <p className="eyebrow">Aktive kriterier</p>
                <p>{describeCriteria(criteria)}</p>
              </div>
            </div>
            <Filters criteria={criteria} onChange={setCriteria} />
            <NewsSection
              news={snapshot?.news ?? null}
              stocks={screenResult.matches}
            />
            <StockTable
              stocks={screenResult.matches}
              criteria={criteria}
              today={today}
            />
            <Exclusions result={screenResult} />
          </div>
        </details>
      ) : null}

      <ReportHistory
        history={history}
        today={today}
        onView={(reportId) => void viewReport(reportId)}
      />
    </div>
  );
}

function computeStats(screenResult: ScreenResult | null): {
  medianWeek: number | null;
  medianDistance: number | null;
} {
  if (!screenResult) {
    return { medianWeek: null, medianDistance: null };
  }
  const weeks = screenResult.matches
    .map((stock) => stock.weekReturn)
    .filter((value): value is number => value !== null);
  const distances = screenResult.matches
    .map((stock) => distanceToAth(stock))
    .filter((value): value is number => value !== null);
  return {
    medianWeek: median(weeks),
    medianDistance: median(distances),
  };
}

function Exclusions({ result }: { result: ScreenResult }) {
  const entries = Object.entries(result.excluded).filter(([, count]) => count > 0);
  if (entries.length === 0) {
    return null;
  }
  return (
    <details className="exclusions">
      <summary>
        Hvorfor ble {result.universeSize - result.matches.length} aksjer
        filtrert bort?
      </summary>
      <ul className="exclusion-list">
        {entries.map(([reason, count]) => (
          <li key={reason}>
            <span>{EXCLUSION_LABELS[reason] ?? reason}</span>
            <strong>{formatNumber(count, 0)}</strong>
          </li>
        ))}
      </ul>
    </details>
  );
}
