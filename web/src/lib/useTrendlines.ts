import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMarketSnapshot, type MarketSnapshot } from "./api";

interface TrendlineState {
  snapshot: MarketSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTrendlines(): TrendlineState {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      setSnapshot(await fetchMarketSnapshot());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    void load(false);
  }, [load]);

  const refresh = useCallback(async () => load(true), [load]);
  return { snapshot, loading, refreshing, error, refresh };
}
