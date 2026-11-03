import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, settingsForCapital, type Settings } from "../core/config";
import { deriveCash } from "../core/journal";
import { buildPremarketReport } from "../core/premarket";
import { DEFAULT_CRITERIA, screen, type Criteria } from "../core/screen";
import type { PremarketReport } from "../core/types";
import {
  fetchMarketSnapshot,
  fetchOpeningSnapshot,
  loadReportByDate,
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
  openingSnapshot: MarketSnapshot | null;
  openingRefreshing: boolean;
  openingError: string | null;
  report: PremarketReport | null;
  viewedReport: PremarketReport | null;
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
  refreshOpening: () => Promise<void>;
  viewReport: (reportId: string) => Promise<void>;
  clearViewedReport: () => void;
}

export function useDashboard(userId: string): DashboardState {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [openingSnapshot, setOpeningSnapshot] =
    useState<MarketSnapshot | null>(null);
  const [openingRefreshing, setOpeningRefreshing] = useState(false);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const [report, setReport] = useState<PremarketReport | null>(null);
  const [viewedReport, setViewedReport] = useState<PremarketReport | null>(null);
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
      setOpeningError(null);

      const date = todayDate();
      const now = new Date();
      try {
        const [loadedSettings, loadedJournal, loadedHistory, existingReport] =
          await Promise.all([
            loadSettings(userId).catch(() => DEFAULT_SETTINGS),
            loadJournal(userId).catch(() => null),
            loadReportHistory(userId).catch(() => []),
            loadReportByDate(userId, date),
          ]);
        setSettings(loadedSettings);
        setJournal(loadedJournal);
        setHistory(loadedHistory);
        setReport(existingReport);

        let freshSnapshot: MarketSnapshot | null = null;
        let snapshotWarning: string | null = null;
        try {
          freshSnapshot = await fetchMarketSnapshot();
          setSnapshot(freshSnapshot);
          setOpeningSnapshot(freshSnapshot);
        } catch (snapshotError) {
          snapshotWarning =
            snapshotError instanceof Error
              ? snapshotError.message
              : String(snapshotError);
          if (!existingReport) {
            setSnapshot(null);
            throw new Error(
              `Kunne ikke hente markedsdata og det finnes ingen lagret rapport for i dag. ${snapshotWarning}`,
            );
          }
          setSnapshot(null);
        }

        let createdReport = false;
        if (!existingReport && freshSnapshot) {
          const result = screen(
            freshSnapshot.universe.stocks,
            criteriaRef.current,
          );
          const cash = loadedJournal ? deriveCash(loadedJournal) : 5000;
          const reportSettings = settingsForCapital(loadedSettings, cash);
          const built = buildPremarketReport(
            result.matches,
            criteriaRef.current,
            freshSnapshot.universe,
            freshSnapshot.news,
            reportSettings,
            date,
            now,
          );
          const savedReport = await saveReport(userId, date, built);
          createdReport = true;
          setReport(savedReport);
          setHistory(await loadReportHistory(userId).catch(() => loadedHistory));
        }

        if (snapshotWarning) {
          setWarning(
            `Ferske markedsdata kunne ikke hentes (${snapshotWarning}). Viser lagret rapport for i dag.`,
          );
        } else if (isRefresh) {
          setNotice(
            createdReport
              ? "Markedsdata er oppdatert, og dagens rapport er opprettet."
              : "Markedsdata er oppdatert. Dagens rapport er ikke endret.",
          );
        }
        if (!loadedJournal) {
          setWarning(
            (current) =>
              current ??
              "Handelsdagboken kunne ikke leses. Rapporten bruker standard kapital.",
          );
        }
        return !snapshotWarning;
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
    await load(true);
  }, [load]);

  const refreshOpening = useCallback(async () => {
    setOpeningRefreshing(true);
    setOpeningError(null);
    try {
      const fresh = await fetchOpeningSnapshot();
      setOpeningSnapshot(fresh);
    } catch (refreshError) {
      setOpeningError(
        refreshError instanceof Error
          ? refreshError.message
          : String(refreshError),
      );
    } finally {
      setOpeningRefreshing(false);
    }
  }, []);

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
    openingSnapshot,
    openingRefreshing,
    openingError,
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
    refreshOpening,
    viewReport,
    clearViewedReport,
  };
}
