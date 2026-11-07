import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadSimulator,
  type SimulatorData,
} from "./api";

interface SimulatorState {
  data: SimulatorData | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  loadedAt: Date | null;
  refresh: () => Promise<void>;
}

const REFRESH_MS = 60_000;

/**
 * Reads the shared paper-trading portfolios. The scheduled tick only writes
 * every ten minutes, so a one-minute refresh is enough to keep the view
 * current without hammering the database.
 */
export function useSimulator(): SimulatorState {
  const [data, setData] = useState<SimulatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (isRefresh: boolean) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    if (isRefresh) {
      setRefreshing(true);
    }
    try {
      const next = await loadSimulator();
      setData(next);
      setError(null);
      setLoadedAt(new Date());
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => {
      void load(false);
    }, 0);
    const timer = window.setInterval(() => {
      void load(true);
    }, REFRESH_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [load]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  return { data, loading, refreshing, error, loadedAt, refresh };
}
