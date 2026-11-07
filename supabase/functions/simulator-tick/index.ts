// Scheduled paper-trading tick for the swing and Etrade portfolios.
//
// Deploy with:
//   supabase functions deploy simulator-tick --no-verify-jwt
//
// Secrets:
//   CRON_SECRET        shared secret checked on the x-cron-secret header
//   SIMULATOR_SECRET   shared secret used when calling market-snapshot
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
//
// The function only runs while Oslo Børs is open and the snapshot is fresh.
// It never places real orders: results are written to the simulator tables by
// the apply_simulator_tick RPC.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
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
const MODES: SimMode[] = ["swing", "etrade"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
const simulatorSecret = Deno.env.get("SIMULATOR_SECRET") ?? "";
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
  const states = {
    swing: emptyPortfolioState(),
    etrade: emptyPortfolioState(),
  } as Record<SimMode, SimPortfolioState>;
  for (const row of data ?? []) {
    if (row.mode !== "swing" && row.mode !== "etrade") {
      continue;
    }
    states[row.mode] = {
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
      summary: {
        source: snapshot.universe.source,
        stocks: snapshot.universe.stocks.length,
        trades,
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
