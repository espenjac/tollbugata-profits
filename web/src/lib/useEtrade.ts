import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  settingsForCapital,
  type Settings,
} from "../core/config";
import { buildEtradeReport, type EtradeReport } from "../core/etrade";
import { deriveCash } from "../core/journal";
import { DEFAULT_CRITERIA, screen } from "../core/screen";
import {
  fetchMarketSnapshot,
  loadJournal,
  loadSettings,
  todayDate,
  type MarketSnapshot,
} from "./api";

interface EtradeState {
  snapshot: MarketSnapshot | null;
  report: EtradeReport | null;
  settings: Settings;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  warning: string | null;
  notice: string | null;
  refresh: () => Promise<void>;
}

export function useEtrade(userId: string): EtradeState {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [report, setReport] = useState<EtradeReport | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);

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
        const [loadedSettings, loadedJournal] = await Promise.all([
          loadSettings(userId).catch(() => DEFAULT_SETTINGS),
          loadJournal(userId).catch(() => null),
        ]);
        setSettings(loadedSettings);

        // Etrade ideas are always built from a fresh snapshot. They are not
        // stored as a daily report, so there is no stale report to fall back to.
        const freshSnapshot = await fetchMarketSnapshot();
        setSnapshot(freshSnapshot);

        const result = screen(freshSnapshot.universe.stocks, DEFAULT_CRITERIA);
        const cash = loadedJournal ? deriveCash(loadedJournal) : 5000;
        const built = buildEtradeReport(
          result.matches,
          freshSnapshot.universe,
          freshSnapshot.news,
          settingsForCapital(loadedSettings, cash),
          date,
          now,
        );
        setReport(built);

        if (isRefresh) {
          setNotice("Etrade-ideene er oppdatert med siste kurs.");
        }
        if (!loadedJournal) {
          setWarning(
            "Handelsdagboken kunne ikke leses. Etrade bruker standard kapital.",
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
    if (!userId || startedFor.current === userId) {
      return;
    }
    startedFor.current = userId;
    void load(false);
  }, [userId, load]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  return {
    snapshot,
    report,
    settings,
    loading,
    refreshing,
    error,
    warning,
    notice,
    refresh,
  };
}
