// Returns the last Nordnet price for one ticker. Nordnet does not expose a
// public quote endpoint without a session, but its stock pages include the
// latest price snapshot in the server-rendered HTML. The PWA calls this
// function from the buy buttons so the journal is prefilled with Nordnet's
// price instead of the TradingView scanner price.
//
// Deploy with:
//   supabase functions deploy nordnet-quote
//
// The function uses the same ALLOWED_EMAILS / OWNER_EMAIL gate as
// `market-snapshot`.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseNordnetPriceHtml } from "../_shared/nordnetQuote.ts";

const NORDNET_BASE = "https://www.nordnet.no/aksjer/kurser/";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 TollbugataProfits/2.0";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,200}$/;
const TICKER_RE = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
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

function allowedEmails(): string[] {
  return [Deno.env.get("ALLOWED_EMAILS") ?? "", Deno.env.get("OWNER_EMAIL") ?? ""]
    .join(",")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) {
      return json({ error: "Missing bearer token" }, 401);
    }
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) {
      return json({ error: "Invalid session" }, 401);
    }

    const permitted = allowedEmails();
    const userEmail = data.user.email?.trim().toLowerCase();
    if (permitted.length > 0 && (!userEmail || !permitted.includes(userEmail))) {
      return json({ error: "This account is not allowed" }, 403);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Expected a JSON body" }, 400);
    }

    const ticker = String(body.ticker ?? "").trim().toUpperCase();
    const slug = String(body.slug ?? "").trim().toLowerCase();
    if (!TICKER_RE.test(ticker)) {
      return json({ error: "Ticker mangler eller er ugyldig." }, 400);
    }
    if (!SLUG_RE.test(slug)) {
      return json({ error: "Nordnet-slug mangler eller er ugyldig." }, 400);
    }

    const response = await fetch(NORDNET_BASE + slug, {
      signal: AbortSignal.timeout(25_000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      throw new Error(`Nordnet svarte HTTP ${response.status} for ${ticker}.`);
    }

    const quote = parseNordnetPriceHtml(await response.text());
    if (!quote) {
      throw new Error(`Fant ikke siste Nordnet-kurs for ${ticker}.`);
    }

    return json({
      ticker,
      slug,
      last: quote.last,
      bid: quote.bid,
      ask: quote.ask,
      close: quote.close,
      timestamp: quote.timestamp,
      fetchedAt: new Date().toISOString(),
      source: "nordnet",
    });
  } catch (error) {
    console.error("nordnet-quote failed", error);
    return json({ error: errorMessage(error) }, 502);
  }
});
