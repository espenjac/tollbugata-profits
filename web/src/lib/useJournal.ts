import { useCallback, useEffect, useRef, useState } from "react";
import {
  addTrade,
  cashAdjustment,
  editTrade,
  loadJournal,
} from "../lib/api";
import type { JournalState, TradeInput } from "../core/journal";

export interface JournalActions {
  reload: () => Promise<void>;
  add: (input: TradeInput) => Promise<void>;
  edit: (tradeId: string, input: Omit<TradeInput, "id">) => Promise<void>;
  setCash: (newCash: number, note: string) => Promise<void>;
}

export interface JournalHookValue extends JournalActions {
  journal: JournalState | null;
  loading: boolean;
  error: string | null;
  status: string | null;
  clearStatus: () => void;
}

export function useJournal(userId: string): JournalHookValue {
  const [journal, setJournal] = useState<JournalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setJournal(await loadJournal(userId));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || startedFor.current === userId) {
      return;
    }
    startedFor.current = userId;
    void reload();
  }, [userId, reload]);

  useEffect(() => {
    if (!status) {
      return;
    }
    const timer = window.setTimeout(() => setStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const add = useCallback(
    async (input: TradeInput) => {
      if (!journal) {
        throw new Error("Handelsdagboken er ikke lastet.");
      }
      setError(null);
      try {
        await addTrade(userId, journal, input);
        setStatus("Handelen er loggført.");
        await reload();
      } catch (actionError) {
        const message =
          actionError instanceof Error ? actionError.message : String(actionError);
        setError(message);
        throw actionError;
      }
    },
    [journal, reload, userId],
  );

  const edit = useCallback(
    async (tradeId: string, input: Omit<TradeInput, "id">) => {
      if (!journal) {
        throw new Error("Handelsdagboken er ikke lastet.");
      }
      setError(null);
      try {
        await editTrade(userId, journal, tradeId, input);
        setStatus("Handelen er oppdatert.");
        await reload();
      } catch (actionError) {
        const message =
          actionError instanceof Error ? actionError.message : String(actionError);
        setError(message);
        throw actionError;
      }
    },
    [journal, reload, userId],
  );

  const setCash = useCallback(
    async (newCash: number, note: string) => {
      if (!journal) {
        throw new Error("Handelsdagboken er ikke lastet.");
      }
      setError(null);
      try {
        await cashAdjustment(userId, journal, newCash, note);
        setStatus("Ledig kapital er korrigert.");
        await reload();
      } catch (actionError) {
        const message =
          actionError instanceof Error ? actionError.message : String(actionError);
        setError(message);
        throw actionError;
      }
    },
    [journal, reload, userId],
  );

  return {
    journal,
    loading,
    error,
    status,
    clearStatus: () => setStatus(null),
    reload,
    add,
    edit,
    setCash,
  };
}
