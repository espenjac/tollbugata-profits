import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import { osloDateString } from "../core/dates";
import { mergeSettings, type Settings } from "../core/config";
import {
  recordTrade,
  setAvailableCash,
  updateTrade,
  type CashAdjustment,
  type JournalState,
  type TradeEntry,
  type TradeInput,
} from "../core/journal";
import {
  parseMarketSnapshot,
  type MarketSnapshot,
  type RawSnapshot,
} from "../core/snapshot";
import type { MarketReport } from "../core/types";
import type {
  SimEquity,
  SimMode,
  SimPendingOrder,
  SimPosition,
  SimTrade,
} from "../core/simulator";
import { requireSupabase } from "./supabase";

export type { MarketSnapshot } from "../core/snapshot";

export interface ReportHistoryItem {
  id: string;
  date: string;
  generatedAt: Date;
  mainTicker: string | null;
  mainScore: number | null;
  noTrade: boolean;
}

export async function edgeFunctionErrorMessage(
  error: unknown,
): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const status = error.context.status;
    if (status === 401) {
      return "Innloggingen er utløpt. Logg inn på nytt.";
    }
    if (status === 403) {
      return "Denne kontoen har ikke tilgang. Kontakt eieren for å bli lagt til.";
    }
    try {
      const body = (await error.context.clone().json()) as {
        error?: unknown;
        message?: unknown;
      };
      if (typeof body.error === "string" && body.error.trim()) {
        return body.error;
      }
      if (typeof body.message === "string" && body.message.trim()) {
        return body.message;
      }
    } catch {
      // The error body was not JSON; fall back to the generic Functions error.
    }
    return error.message;
  }
  if (error instanceof FunctionsRelayError) {
    return "Supabase fikk ikke kontakt med markedsfunksjonen. Prøv igjen om litt.";
  }
  if (error instanceof FunctionsFetchError) {
    return "Kunne ikke kontakte Supabase. Sjekk nettverket og prøv igjen.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<RawSnapshot>(
    "market-snapshot",
    {
      method: "POST",
      body: {},
    },
  );
  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error));
  }
  return parseMarketSnapshot(data ?? {});
}

function payloadForReport(report: MarketReport): Record<string, unknown> {
  return JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
}

function hydrateReport(row: {
  generated_at?: string;
  payload: unknown;
}): MarketReport {
  const raw = row.payload as Record<string, unknown>;
  return {
    ...(raw as unknown as MarketReport),
    generatedAt: new Date(
      (row.generated_at as string | undefined) ??
        (raw.generatedAt as string | undefined) ??
        Date.now(),
    ),
    universeFetchedAt: new Date(
      (raw.universeFetchedAt as string | undefined) ?? Date.now(),
    ),
    newsSince: raw.newsSince
      ? new Date(raw.newsSince as string)
      : null,
    marketOpen: Boolean(raw.marketOpen),
  };
}

export async function loadReportByDate(
  userId: string,
  date: string,
): Promise<MarketReport | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("reports")
    .select("generated_at,payload")
    .eq("user_id", userId)
    .eq("report_date", date)
    .maybeSingle();
  if (error) {
    throw new Error(`Kunne ikke lese rapporten: ${error.message}`);
  }
  return data ? hydrateReport(data) : null;
}

export async function saveReport(
  userId: string,
  date: string,
  report: MarketReport,
): Promise<MarketReport> {
  const client = requireSupabase();
  const { error } = await client.from("reports").upsert(
    {
      user_id: userId,
      report_date: date,
      generated_at: report.generatedAt.toISOString(),
      main_ticker: report.main?.candidate.stock.ticker ?? null,
      main_score: report.main?.candidate.score ?? null,
      no_trade: report.main === null,
      payload: payloadForReport(report),
    },
    { onConflict: "user_id,report_date" },
  );
  if (error) {
    throw new Error(`Kunne ikke lagre rapporten: ${error.message}`);
  }
  const saved = await loadReportByDate(userId, date);
  return saved ?? report;
}

export async function loadReportHistory(
  userId: string,
  limit = 14,
): Promise<ReportHistoryItem[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("reports")
    .select("id,report_date,generated_at,main_ticker,main_score,no_trade")
    .eq("user_id", userId)
    .order("report_date", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Kunne ikke lese rapporthistorikken: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    date: String(row.report_date),
    generatedAt: new Date(String(row.generated_at)),
    mainTicker: row.main_ticker ? String(row.main_ticker) : null,
    mainScore: row.main_score === null ? null : Number(row.main_score),
    noTrade: Boolean(row.no_trade),
  }));
}

export async function loadReportById(
  userId: string,
  reportId: string,
): Promise<MarketReport | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("reports")
    .select("generated_at,payload")
    .eq("user_id", userId)
    .eq("id", reportId)
    .maybeSingle();
  if (error) {
    throw new Error(`Kunne ikke lese rapporten: ${error.message}`);
  }
  return data ? hydrateReport(data) : null;
}

export async function loadSettings(userId: string): Promise<Settings> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("settings")
    .select("scoring,trade,report")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Kunne ikke lese innstillingene: ${error.message}`);
  }
  if (!data) {
    return mergeSettings({});
  }
  return mergeSettings({
    scoring: (data.scoring ?? {}) as Parameters<typeof mergeSettings>[0]["scoring"],
    trade: (data.trade ?? {}) as Parameters<typeof mergeSettings>[0]["trade"],
    report: (data.report ?? {}) as Parameters<typeof mergeSettings>[0]["report"],
  });
}

interface AccountRow {
  starting_cash: number | string;
}

interface TradeRow {
  id: string;
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  price: number | string;
  fee: number | string;
  executed_at: string;
  note: string;
  created_at: string;
  updated_at: string;
}

interface AdjustmentRow {
  id: string;
  amount: number | string;
  note: string;
  changed_at: string;
}

export async function loadJournal(userId: string): Promise<JournalState> {
  const client = requireSupabase();
  let accountResult = await client
    .from("accounts")
    .select("starting_cash")
    .eq("user_id", userId)
    .maybeSingle();
  if (accountResult.error) {
    throw new Error(`Kunne ikke lese kontoen: ${accountResult.error.message}`);
  }
  if (!accountResult.data) {
    const created = await client
      .from("accounts")
      .upsert({ user_id: userId, starting_cash: 5000 }, { onConflict: "user_id" })
      .select("starting_cash")
      .single();
    if (created.error) {
      throw new Error(`Kunne ikke opprette kontoen: ${created.error.message}`);
    }
    accountResult = created;
  }

  const [tradesResult, adjustmentsResult] = await Promise.all([
    client
      .from("trades")
      .select(
        "id,ticker,side,quantity,price,fee,executed_at,note,created_at,updated_at",
      )
      .eq("user_id", userId)
      .order("executed_at", { ascending: true })
      .order("created_at", { ascending: true }),
    client
      .from("cash_adjustments")
      .select("id,amount,note,changed_at")
      .eq("user_id", userId)
      .order("changed_at", { ascending: true }),
  ]);
  if (tradesResult.error) {
    throw new Error(`Kunne ikke lese handler: ${tradesResult.error.message}`);
  }
  if (adjustmentsResult.error) {
    throw new Error(
      `Kunne ikke lese saldojusteringer: ${adjustmentsResult.error.message}`,
    );
  }

  const trades: TradeEntry[] = (tradesResult.data as TradeRow[]).map((row) => ({
    id: row.id,
    executedAt: row.executed_at,
    registeredAt: row.created_at,
    ticker: row.ticker,
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fee: Number(row.fee),
    note: row.note,
    editedAt:
      row.updated_at && row.updated_at !== row.created_at
        ? row.updated_at
        : null,
  }));
  const adjustments: CashAdjustment[] = (
    adjustmentsResult.data as AdjustmentRow[]
  ).map((row) => ({
    id: row.id,
    changedAt: row.changed_at,
    amount: Number(row.amount),
    note: row.note,
  }));

  const account = accountResult.data as AccountRow;
  return {
    startingCash: Number(account.starting_cash),
    trades,
    adjustments,
    updatedAt: new Date().toISOString(),
  };
}

export async function addTrade(
  userId: string,
  state: JournalState,
  input: TradeInput,
): Promise<void> {
  const next = recordTrade(state, input);
  const trade = next.trades[next.trades.length - 1];
  const client = requireSupabase();
  const { error } = await client.from("trades").insert({
    id: trade.id,
    user_id: userId,
    ticker: trade.ticker,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    fee: trade.fee,
    executed_at: trade.executedAt,
    note: trade.note,
  });
  if (error) {
    throw new Error(`Kunne ikke lagre handelen: ${error.message}`);
  }
}

export async function editTrade(
  userId: string,
  state: JournalState,
  tradeId: string,
  input: Omit<TradeInput, "id">,
): Promise<void> {
  const next = updateTrade(state, tradeId, input);
  const trade = next.trades.find((item) => item.id === tradeId);
  if (!trade) {
    throw new Error("Fant ikke handelen som skulle oppdateres.");
  }
  const client = requireSupabase();
  const { error } = await client
    .from("trades")
    .update({
      ticker: trade.ticker,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.price,
      fee: trade.fee,
      executed_at: trade.executedAt,
      note: trade.note,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", tradeId);
  if (error) {
    throw new Error(`Kunne ikke oppdatere handelen: ${error.message}`);
  }
}

export async function cashAdjustment(
  userId: string,
  state: JournalState,
  newCash: number,
  note: string,
  changedAt = new Date().toISOString(),
): Promise<void> {
  const next = setAvailableCash(state, newCash, note, changedAt);
  const adjustment = next.adjustments[next.adjustments.length - 1];
  const client = requireSupabase();
  const { error } = await client.from("cash_adjustments").insert({
    id: adjustment.id,
    user_id: userId,
    amount: adjustment.amount,
    note: adjustment.note,
    changed_at: adjustment.changedAt,
  });
  if (error) {
    throw new Error(`Kunne ikke lagre saldojusteringen: ${error.message}`);
  }
}

export function todayDate(): string {
  return osloDateString(new Date());
}

export interface SimulatorPortfolio {
  mode: SimMode;
  startingCash: number;
  cash: number;
  position: SimPosition | null;
  pending: SimPendingOrder | null;
  updatedAt: Date | null;
}

export interface SimulatorTradeRecord extends SimTrade {
  id: number;
  mode: SimMode;
}

export interface SimulatorEquityPoint extends SimEquity {
  mode: SimMode;
  day: string;
  benchmark: number | null;
  recordedAt: Date;
}

export interface SimulatorData {
  portfolios: SimulatorPortfolio[];
  trades: SimulatorTradeRecord[];
  equity: SimulatorEquityPoint[];
}

interface SimulatorPortfolioRow {
  mode: SimMode;
  starting_cash: number | string;
  cash: number | string;
  position: SimPosition | null;
  pending: SimPendingOrder | null;
  updated_at: string | null;
}

interface SimulatorTradeRow {
  id: number;
  mode: SimMode;
  ticker: string;
  side: "buy" | "sell";
  quantity: number | string;
  price: number | string;
  fee: number | string;
  realized_pnl: number | string | null;
  reason: string;
  executed_at: string;
}

interface SimulatorEquityRow {
  mode: SimMode;
  day: string;
  cash: number | string;
  position_value: number | string;
  equity: number | string;
  benchmark: number | string | null;
  recorded_at: string;
}

/**
 * Loads the shared paper portfolios, their trade history and the daily equity
 * curve. All three tables are read-only for authenticated users.
 */
export async function loadSimulator(): Promise<SimulatorData> {
  const client = requireSupabase();
  const [portfolios, trades, equity] = await Promise.all([
    client
      .from("sim_portfolios")
      .select("mode,starting_cash,cash,position,pending,updated_at"),
    client
      .from("sim_trades")
      .select(
        "id,mode,ticker,side,quantity,price,fee,realized_pnl,reason,executed_at",
      )
      .order("executed_at", { ascending: false })
      .limit(300),
    client
      .from("sim_equity_daily")
      .select("mode,day,cash,position_value,equity,benchmark,recorded_at")
      .order("day", { ascending: true }),
  ]);

  for (const result of [portfolios, trades, equity]) {
    if (result.error) {
      throw new Error(`Kunne ikke lese simulatoren: ${result.error.message}`);
    }
  }

  return {
    portfolios: (portfolios.data as SimulatorPortfolioRow[]).map((row) => ({
      mode: row.mode,
      startingCash: Number(row.starting_cash),
      cash: Number(row.cash),
      position: row.position,
      pending: row.pending,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    })),
    trades: (trades.data as SimulatorTradeRow[]).map((row) => ({
      id: row.id,
      mode: row.mode,
      ticker: row.ticker,
      side: row.side,
      quantity: Number(row.quantity),
      price: Number(row.price),
      fee: Number(row.fee),
      realizedPnl:
        row.realized_pnl === null ? null : Number(row.realized_pnl),
      reason: row.reason,
      executedAt: row.executed_at,
    })),
    equity: (equity.data as SimulatorEquityRow[]).map((row) => ({
      mode: row.mode,
      day: row.day,
      cash: Number(row.cash),
      positionValue: Number(row.position_value),
      equity: Number(row.equity),
      benchmark: row.benchmark === null ? null : Number(row.benchmark),
      recordedAt: new Date(row.recorded_at),
    })),
  };
}
