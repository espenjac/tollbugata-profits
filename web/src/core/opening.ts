import type { TradeConfig } from "./config";
import { osloParts } from "./dates";
import { buildTradePlan, simulateNet } from "./trade";
import type { PlannedCandidate, Stock, TradePlan } from "./types";

export type OpeningPhase = "pre" | "opening" | "open" | "closed";
export type OpeningStatus =
  | "for-tidlig"
  | "vent"
  | "klar"
  | "stoppet"
  | "target"
  | "ugyldig"
  | "stengt";

export const OPENING_STATUS_LABELS: Record<OpeningStatus, string> = {
  "for-tidlig": "Før åpning",
  vent: "Vent",
  klar: "Innenfor plan",
  stoppet: "Stop brutt",
  target: "Target nådd",
  ugyldig: "Ugyldig",
  stengt: "Stengt",
};

/** Oslo Børs opens at 09:00. The first minutes are opening-auction noise. */
export const OPENING_PLAN_READY_MINUTES = 15;
export const OPENING_PLAN_RECOMMENDED_MINUTES = 30;
export const BIG_GAP_PCT = 0.02;

export interface OpeningPlan {
  ticker: string;
  name: string;
  referenceEntry: number;
  openingPrice: number | null;
  currentPrice: number;
  high: number | null;
  low: number | null;
  vwap: number | null;
  gapPct: number | null;
  vsVwapPct: number | null;
  oldTarget: number;
  oldStop: number;
  oldRewardRiskAtOpen: number | null;
  newPlan: TradePlan | null;
  currentRewardRisk: number | null;
  status: OpeningStatus;
  statusText: string;
  reasons: string[];
}

export function marketPhase(now: Date = new Date()): OpeningPhase {
  const parts = osloParts(now);
  if (parts.weekday === 0 || parts.weekday === 6) {
    return "closed";
  }
  const minutes = parts.hour * 60 + parts.minute;
  const marketOpen = 9 * 60;
  const marketClose = 16 * 60 + 30;
  if (minutes < marketOpen) {
    return "pre";
  }
  if (minutes < marketOpen + OPENING_PLAN_READY_MINUTES) {
    return "opening";
  }
  if (minutes <= marketClose) {
    return "open";
  }
  return "closed";
}

export function openingTimingText(phase: OpeningPhase): string {
  switch (phase) {
    case "pre":
      return "Børsen åpner 09:00. Vent til 09:15–09:30 før du bruker åpningsplanen.";
    case "opening":
      return "Første kvarter er åpningsstøy. Vent til 09:15, og helst til 09:30.";
    case "open":
      return "Anbefalt vindu er 09:15–09:30. Bruk åpningskurs og VWAP som bekreftelse.";
    case "closed":
      return "Børsen er stengt. Åpningsplanen viser dagens åpning og siste kurs.";
  }
}

function netRewardRisk(
  entry: number,
  target: number,
  stop: number,
  config: TradeConfig,
): number | null {
  if (entry <= 0 || target <= entry || stop >= entry) {
    return null;
  }
  const targetResult = simulateNet(entry, target, config);
  const stopResult = simulateNet(entry, stop, config);
  if (targetResult.net <= 0 || stopResult.net >= 0) {
    return null;
  }
  return targetResult.net / Math.abs(stopResult.net);
}

export function buildOpeningPlan(
  planned: PlannedCandidate,
  quote: Stock | null,
  config: TradeConfig,
  now: Date = new Date(),
): OpeningPlan {
  const phase = marketPhase(now);
  const referenceEntry = planned.trade.entryPrice;
  const oldTarget = planned.trade.targetPrice;
  const oldStop = planned.trade.stopPrice;
  const openingPrice = quote?.open ?? null;
  const currentPrice = quote?.close ?? referenceEntry;

  if (!quote || openingPrice === null || openingPrice <= 0) {
    return {
      ticker: planned.candidate.stock.ticker,
      name: planned.candidate.stock.name,
      referenceEntry,
      openingPrice,
      currentPrice,
      high: quote?.high ?? null,
      low: quote?.low ?? null,
      vwap: quote?.vwap ?? null,
      gapPct: null,
      vsVwapPct: null,
      oldTarget,
      oldStop,
      oldRewardRiskAtOpen: null,
      newPlan: null,
      currentRewardRisk: null,
      status: phase === "pre" ? "for-tidlig" : "ugyldig",
      statusText:
        phase === "pre"
          ? "Venter på åpning"
          : "Mangler åpningskurs fra TradingView",
      reasons: ["Trykk «Hent åpningskurser» for ferske data."],
    };
  }

  const gapPct = openingPrice / referenceEntry - 1;
  const vwap = quote.vwap;
  const vsVwapPct =
    vwap !== null && vwap > 0 ? currentPrice / vwap - 1 : null;
  const newPlan = buildTradePlan(openingPrice, config);
  const oldRewardRiskAtOpen = netRewardRisk(
    openingPrice,
    oldTarget,
    oldStop,
    config,
  );
  const currentRewardRisk = newPlan.feasible
    ? netRewardRisk(currentPrice, newPlan.targetPrice, newPlan.stopPrice, config)
    : null;
  const reasons: string[] = [];

  if (Math.abs(gapPct) >= BIG_GAP_PCT) {
    reasons.push(
      `${gapPct > 0 ? "Gap opp" : "Gap ned"} ${(Math.abs(gapPct) * 100).toFixed(1)} % fra rapportens entry.`,
    );
  }
  if (openingPrice >= oldTarget) {
    reasons.push("Gammel target lå under åpningskurs – gammel plan er ugyldig.");
  } else if (openingPrice <= oldStop) {
    reasons.push("Gammel stop lå over åpningskurs – gammel plan er ugyldig.");
  } else if (oldRewardRiskAtOpen !== null && oldRewardRiskAtOpen < 1.5) {
    reasons.push(
      `Gammel plan hadde R:R ${oldRewardRiskAtOpen.toFixed(2)} ved åpning.`,
    );
  }
  if (vsVwapPct !== null) {
    reasons.push(
      `Kursen er ${Math.abs(vsVwapPct * 100).toFixed(1)} % ${vsVwapPct >= 0 ? "over" : "under"} VWAP.`,
    );
  }

  let status: OpeningStatus;
  let statusText: string;
  if (phase === "pre") {
    status = "for-tidlig";
    statusText = "Venter på åpning";
  } else if (phase === "opening") {
    status = "vent";
    statusText = "Første kvarter – vent";
  } else if (!newPlan.feasible) {
    status = "ugyldig";
    statusText = "For liten kapital til én aksje";
  } else if (currentPrice <= newPlan.stopPrice) {
    status = "stoppet";
    statusText = "Under ny stop";
  } else if (currentPrice >= newPlan.targetPrice) {
    status = "target";
    statusText = "Over ny target";
  } else if (phase === "closed") {
    status = "stengt";
    statusText = "Børsen er stengt";
  } else if (vwap !== null && currentPrice < vwap) {
    status = "vent";
    statusText = "Under VWAP";
  } else if (gapPct > BIG_GAP_PCT && currentPrice < openingPrice) {
    status = "vent";
    statusText = "Gapet ble ikke holdt";
  } else {
    status = "klar";
    statusText = vwap !== null ? "Over VWAP" : "Over åpningskurs";
  }

  return {
    ticker: planned.candidate.stock.ticker,
    name: planned.candidate.stock.name,
    referenceEntry,
    openingPrice,
    currentPrice,
    high: quote.high,
    low: quote.low,
    vwap,
    gapPct,
    vsVwapPct,
    oldTarget,
    oldStop,
    oldRewardRiskAtOpen,
    newPlan: newPlan.feasible ? newPlan : null,
    currentRewardRisk,
    status,
    statusText,
    reasons,
  };
}
