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
import { parseScannerPayload } from "../core/market";
import { emptyNewsFeed, parseNewsPayload, type NewsFeed } from "../core/news";
import type { MarketReport, Universe } from "../core/types";
import { requireSupabase } from "./supabase";

export interface ReportHistoryItem {
  id: string;
  date: string;
  generatedAt: Date;
  mainTicker: string | null;
  mainScore: number | null;
  noTrade: boolean;
}

interface RawSnapshotSource<T> {
  payload?: T;
  tickers?: string[];
  since?: string;
  fetchedAt?: string;
  warning?: string | null;
  source?: string;
}

interface RawSnapshot {
  generatedAt?: string;
  scan?: RawSnapshotSource<unknown>;
  growth?: RawSnapshotSource<unknown>;
  news?: RawSnapshotSource<unknown>;
  error?: string;
}

export interface MarketSnapshot {
  universe: Universe;
  news: NewsFeed;
  generatedAt: Date;
}

function sourceValue(
  value: string | undefined,
): "live" | "cache" | "stale-cache" {
  if (value === "cache" || value === "stale-cache") {
    return value;
  }
  return "live";
}

function newsSourceValue(
  value: string | undefined,
): "live" | "cache" | "stale-cache" | "error" {
  if (value === "cache" || value === "stale-cache" || value === "error") {
    return value;
  }
  return "live";
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
  if (!data || data.error) {
    throw new Error(data?.error ?? "Markedsfunksjonen svarte uten data.");
  }
  if (!data.scan?.payload) {
    throw new Error("Markedssvaret manglet TradingView-data.");
  }

  const growthTickers = new Set<string>(
    Array.isArray(data.growth?.tickers) ? data.growth.tickers : [],
  );
  const stocks = parseScannerPayload(
    data.scan.payload as { data?: Array<{ s?: string; d?: unknown[] }> },
    growthTickers,
  );
  if (stocks.length === 0) {
    throw new Error("TradingView returnerte ingen aksjer for Oslo Børs.");
  }

  const newsFetchedAt = data.news?.fetchedAt
    ? new Date(data.news.fetchedAt)
    : new Date();
  const newsSince = data.news?.since
    ? new Date(data.news.since)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  let news: NewsFeed;
  try {
    news = parseNewsPayload(
      data.news?.payload,
      newsSince,
      newsFetchedAt,
      newsSourceValue(data.news?.source),
      data.news?.warning ?? null,
    );
  } catch (error) {
    news = emptyNewsFeed(
      newsFetchedAt,
      newsSince,
      error instanceof Error ? error.message : String(error),
    );
  }

  return {
    universe: {
      stocks,
      fetchedAt: data.scan.fetchedAt
        ? new Date(data.scan.fetchedAt)
        : new Date(),
      source: sourceValue(data.scan.source),
      warning: data.scan.warning ?? null,
      growthTickers,
      growthSource: data.growth?.source
        ? newsSourceValue(data.growth.source)
        : "ukjent",
      growthWarning: data.growth?.warning ?? null,
    },
    news,
    generatedAt: data.generatedAt ? new Date(data.generatedAt) : new Date(),
  };
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
