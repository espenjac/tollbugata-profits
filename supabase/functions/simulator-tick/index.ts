// Scheduled paper-trading tick for the swing and Etrade portfolios.
//
// Deploy with:
//   supabase functions deploy simulator-tick --no-verify-jwt
//
// Secrets:
//   CRON_SECRET        shared secret checked on the x-cron-secret header
//   SIMULATOR_SECRET   shared secret used when calling market-snapshot
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT for background push
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
//
// The function only runs while Oslo Børs is open and the snapshot is fresh.
// It never places real orders: results are written to the simulator tables by
// the apply_simulator_tick RPC.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import nordnetSlugs from "../../../web/src/core/nordnet-slugs.json" with { type: "json" };
import {
  DEFAULT_SETTINGS,
  emptyPortfolioState,
  marketSession,
  osloDateString,
  parseMarketSnapshot,
  runSimulatorTick,
  simulatorMayTick,
  type RawSnapshot,
  type SimMode,
  type SimPortfolioState,
} from "./strategy.mjs";

const MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1000;
const MODES: SimMode[] = ["swing", "etrade", "trend"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
const simulatorSecret = Deno.env.get("SIMULATOR_SECRET") ?? "";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "";
const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Constant-time-ish compare so the shared secret is not leaked by timing. */
function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function requestSecret(request: Request): string {
  const header = request.headers.get("x-cron-secret") ?? "";
  if (header) {
    return header;
  }
  const authorization = request.headers.get("Authorization") ?? "";
  return authorization.replace(/^Bearer\s+/i, "");
}

interface PushSubscriptionRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

interface TradeNotification {
  mode: SimMode;
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  executedAt: string;
}

function nordnetUrlForTicker(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  const slugs = nordnetSlugs as Record<string, string>;
  const slug = slugs[normalized] ?? `${normalized.toLowerCase()}-xosl`;
  return `https://www.nordnet.no/aksjer/kurser/${slug}`;
}

async function sendTradeNotifications(trades: TradeNotification[]): Promise<void> {
  if (trades.length === 0) return;
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.warn("Simulator trade push skipped: VAPID secrets are not configured");
    return;
  }

  const { data, error } = await admin
    .from("sim_push_subscriptions")
    .select("user_id,endpoint,p256dh,auth_key");
  if (error) {
    throw new Error(`Could not load push subscriptions: ${error.message}`);
  }
  const subscriptions = (data ?? []) as PushSubscriptionRow[];
  if (subscriptions.length === 0) return;

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const modeLabels: Record<SimMode, string> = {
    swing: "Swing",
    etrade: "Etrade",
    trend: "Trend",
  };

  await Promise.all(
    trades.flatMap((trade) =>
      subscriptions.map(async (row) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: row.endpoint,
              keys: { p256dh: row.p256dh, auth: row.auth_key },
            },
            JSON.stringify({
              title: `${modeLabels[trade.mode]} · ${trade.side === "buy" ? "Kjøp" : "Salg"} ${trade.ticker}`,
              body: `${trade.quantity} aksjer · ${trade.price.toLocaleString("nb-NO")} kr per aksje`,
              ticker: trade.ticker,
              nordnetUrl: nordnetUrlForTicker(trade.ticker),
              tag: `sim-trade-${trade.mode}-${trade.side}-${trade.ticker}-${trade.executedAt}`,
            }),
            { TTL: 3600 },
          );
        } catch (error) {
          const statusCode = Number(
            (error as { statusCode?: number; status?: number }).statusCode ??
              (error as { status?: number }).status ?? 0,
          );
          if (statusCode === 404 || statusCode === 410) {
            await admin
              .from("sim_push_subscriptions")
              .delete()
              .eq("user_id", row.user_id)
              .eq("endpoint", row.endpoint);
          } else {
            console.error("Could not send simulator trade push", error);
          }
        }
      }),
    ),
  );
}

async function fetchSnapshot(): Promise<RawSnapshot> {
  if (!simulatorSecret) {
    throw new Error("SIMULATOR_SECRET is not configured");
  }
  const response = await fetch(`${url}/functions/v1/market-snapshot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      "x-internal-secret": simulatorSecret,
    },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(
      `market-snapshot ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as RawSnapshot;
}

async function loadStates(): Promise<Record<SimMode, SimPortfolioState>> {
  const { data, error } = await admin
    .from("sim_portfolios")
    .select("mode,cash,position,pending");
  if (error) {
    throw new Error(`Could not load simulator state: ${error.message}`);
  }
  const states = Object.fromEntries(
    MODES.map((mode) => [mode, emptyPortfolioState()]),
  ) as Record<SimMode, SimPortfolioState>;
  for (const row of data ?? []) {
    const mode = MODES.find((candidate) => candidate === row.mode);
    if (!mode) {
      continue;
    }
    states[mode] = {
      cash: Number(row.cash),
      position: row.position ?? null,
      pending: row.pending ?? null,
    };
  }
  return states;
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!cronSecret || !safeEqual(requestSecret(request), cronSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const now = new Date();
  if (marketSession(now) !== "open") {
    return json({ ok: true, skipped: "market-closed", at: now.toISOString() });
  }
  if (!simulatorMayTick(now)) {
    return json({
      ok: true,
      skipped: "market-warming-up",
      at: now.toISOString(),
    });
  }

  try {
    const snapshot = parseMarketSnapshot(await fetchSnapshot(), now);
    const age = now.getTime() - snapshot.universe.fetchedAt.getTime();
    if (
      snapshot.universe.source === "stale-cache" ||
      !Number.isFinite(age) ||
      age > MAX_SNAPSHOT_AGE_MS
    ) {
      return json({
        ok: true,
        skipped: "stale-snapshot",
        fetchedAt: snapshot.universe.fetchedAt.toISOString(),
      });
    }

    const states = await loadStates();
    const results = runSimulatorTick({
      snapshot,
      settings: DEFAULT_SETTINGS,
      states,
      now,
      today: osloDateString(now),
    });
    const tickId = crypto.randomUUID();
    const trades = results.reduce(
      (total, result) => total + result.trades.length,
      0,
    );
    const payload = {
      tickId,
      ranAt: now.toISOString(),
      snapshotAt: snapshot.universe.fetchedAt.toISOString(),
      benchmark: snapshot.benchmark?.value ?? null,
      summary: {
        source: snapshot.universe.source,
        stocks: snapshot.universe.stocks.length,
        trades,
        benchmark: snapshot.benchmark?.value ?? null,
      },
      portfolios: results.map((result) => ({
        mode: result.mode,
        state: result.state,
        trades: result.trades,
        equity: result.equity,
      })),
    };

    const { data: applied, error: applyError } = await admin.rpc(
      "apply_simulator_tick",
      { p_tick: payload },
    );
    if (applyError) {
      throw new Error(`apply_simulator_tick failed: ${applyError.message}`);
    }

    if (applied?.applied) {
      const executedTrades = results.flatMap((result) =>
        result.trades
          .map((trade) => ({
            mode: result.mode,
            ticker: trade.ticker,
            side: trade.side,
            quantity: trade.quantity,
            price: trade.price,
            executedAt: trade.executedAt,
          })),
      );
      try {
        await sendTradeNotifications(executedTrades);
      } catch (error) {
        // Push delivery is best effort; it must never roll back a paper-trade tick.
        console.error("Simulator trade notifications failed", error);
      }
    }

    return json({
      ok: true,
      tickId,
      applied,
      trades,
      portfolios: results.map((result) => ({
        mode: result.mode,
        cash: result.equity.cash,
        positionValue: result.equity.positionValue,
        equity: result.equity.equity,
      })),
    });
  } catch (error) {
    console.error("simulator-tick failed", error);
    return json({ error: errorMessage(error) }, 502);
  }
});
