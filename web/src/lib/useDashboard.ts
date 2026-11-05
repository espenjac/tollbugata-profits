import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, settingsForCapital, type Settings } from "../core/config";
import { deriveCash } from "../core/journal";
import { buildMarketReport } from "../core/report";
import { DEFAULT_CRITERIA, screen, type Criteria } from "../core/screen";
import type { MarketReport } from "../core/types";
import {
  fetchMarketSnapshot,
  loadReportById,
  loadReportHistory,
  loadSettings,
  loadJournal,
  saveReport,
  todayDate,
  type MarketSnapshot,
  type ReportHistoryItem,
} from "../lib/api";
import type { JournalState } from "../core/journal";

interface DashboardState {
  snapshot: MarketSnapshot | null;
  report: MarketReport | null;
  viewedReport: MarketReport | null;
  history: ReportHistoryItem[];
  journal: JournalState | null;
  settings: Settings;
  criteria: Criteria;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  warning: string | null;
  notice: string | null;
  screenResult: ReturnType<typeof screen> | null;
  setCriteria: (criteria: Criteria) => void;
  refresh: () => Promise<void>;
  viewReport: (reportId: string) => Promise<void>;
  clearViewedReport: () => void;
}

export function useDashboard(userId: string): DashboardState {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [report, setReport] = useState<MarketReport | null>(null);
  const [viewedReport, setViewedReport] = useState<MarketReport | null>(null);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
  const [journal, setJournal] = useState<JournalState | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [criteria, setCriteria] = useState<Criteria>(DEFAULT_CRITERIA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const criteriaRef = useRef(criteria);
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    criteriaRef.current = criteria;
  }, [criteria]);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      setWarning(null);
      setNotice(null);

      const date = todayDate();
      const now = new Date();
      try {
        const [loadedSettings, loadedJournal, loadedHistory] =
          await Promise.all([
            loadSettings(userId).catch(() => DEFAULT_SETTINGS),
            loadJournal(userId).catch(() => null),
            loadReportHistory(userId).catch(() => []),
          ]);
        setSettings(loadedSettings);
        setJournal(loadedJournal);
        setHistory(loadedHistory);

        // The current report is always rebuilt from a fresh snapshot. Stored
        // reports are only for history, never the current view.
        let freshSnapshot: MarketSnapshot | null = null;
        let snapshotWarning: string | null = null;
        try {
          freshSnapshot = await fetchMarketSnapshot();
          setSnapshot(freshSnapshot);
        } catch (snapshotError) {
          snapshotWarning =
            snapshotError instanceof Error
              ? snapshotError.message
              : String(snapshotError);
          setSnapshot(null);
        }

        if (!freshSnapshot) {
          throw new Error(
            `Kunne ikke hente ferske markedsdata. ${snapshotWarning ?? ""}`.trim(),
          );
        }

        const result = screen(
          freshSnapshot.universe.stocks,
          criteriaRef.current,
        );
        const cash = loadedJournal ? deriveCash(loadedJournal) : 5000;
        const reportSettings = settingsForCapital(loadedSettings, cash);
        const built = buildMarketReport(
          result.matches,
          criteriaRef.current,
          freshSnapshot.universe,
          freshSnapshot.news,
          reportSettings,
          date,
          now,
        );
        setReport(built);
        try {
          const saved = await saveReport(userId, date, built);
          setReport(saved);
        } catch (saveError) {
          setWarning(
            `Rapporten ble oppdatert i appen, men kunne ikke lagres: ${
              saveError instanceof Error ? saveError.message : String(saveError)
            }`,
          );
        }
        setHistory(
          await loadReportHistory(userId).catch(() => loadedHistory),
        );

        if (isRefresh) {
          setNotice("Rapporten er oppdatert med siste kurs.");
        }
        if (!loadedJournal) {
          setWarning(
            (current) =>
              current ??
              "Handelsdagboken kunne ikke leses. Rapporten bruker standard kapital.",
          );
        }
        return true;
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
        return false;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) {
      return;
    }
    if (startedFor.current === userId) {
      return;
    }
    startedFor.current = userId;
    void load(false);
  }, [userId, load]);

  const refresh = useCallback(async () => {
    setViewedReport(null);
    await load(true);
  }, [load]);

  const viewReport = useCallback(
    async (reportId: string) => {
      try {
        const loaded = await loadReportById(userId, reportId);
        if (!loaded) {
          throw new Error("Fant ikke rapporten.");
        }
        setViewedReport(loaded);
        setError(null);
        setNotice(null);
      } catch (viewError) {
        setError(
          viewError instanceof Error ? viewError.message : String(viewError),
        );
      }
    },
    [userId],
  );

  const clearViewedReport = useCallback(() => {
    setViewedReport(null);
    setError(null);
  }, []);

  const screenResult = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    return screen(snapshot.universe.stocks, criteria);
  }, [snapshot, criteria]);

  return {
    snapshot,
    report,
    viewedReport,
    history,
    journal,
    settings,
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
  };
}
