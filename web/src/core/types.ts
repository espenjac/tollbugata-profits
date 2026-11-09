import type { TradeMode } from "./config";

export const ATH_DISTORTION_RATIO = 50;

export type Market = "oslo" | "euronext_growth";
export type InstrumentType = "stock" | "dr" | string;

export interface Stock {
  ticker: string;
  name: string;
  close: number;
  currency: string;
  weekReturn: number | null;
  monthReturn: number | null;
  quarterReturn: number | null;
  sma5: number | null;
  sma20: number | null;
  sma50: number | null;
  rsi: number | null;
  ath: number | null;
  high52w: number | null;
  marketCap: number | null;
  volume: number | null;
  sector: string;
  instrumentType: InstrumentType;
  market: Market;
  earningsDate: string | null;
  exDividendDate: string | null;
  averageVolume10d: number | null;
  atr: number | null;
  dayReturn: number | null;
  /** Today's opening price from the live scanner, when available. */
  open: number | null;
  /** Today's high from the live scanner, when available. */
  high: number | null;
  /** Previous completed session's high, when supplied by the scanner. */
  previousDayHigh: number | null;
  /** Today's low from the live scanner, when available. */
  low: number | null;
  /** Current session VWAP from the live scanner, when available. */
  vwap: number | null;
}

export function isGrowth(stock: Stock): boolean {
  return stock.market === "euronext_growth";
}

export function referenceAth(stock: Stock): number | null {
  const values = [stock.ath, stock.high52w].filter(
    (value): value is number => value !== null && value > 0,
  );
  return values.length > 0 ? Math.max(...values) : null;
}

export function athIsReliable(stock: Stock): boolean {
  if (stock.ath === null || stock.ath <= 0) {
    return false;
  }
  if (stock.high52w !== null && stock.high52w > 0) {
    if (stock.ath > stock.high52w * ATH_DISTORTION_RATIO) {
      return false;
    }
  }
  return true;
}

export function distanceToAth(stock: Stock): number | null {
  if (!athIsReliable(stock)) {
    return null;
  }
  const reference = referenceAth(stock);
  if (reference === null) {
    return null;
  }
  return stock.close / reference - 1;
}

export function turnover(stock: Stock): number | null {
  if (stock.volume === null) {
    return null;
  }
  return stock.close * stock.volume;
}

export function averageTurnover(stock: Stock): number | null {
  if (stock.averageVolume10d === null) {
    return null;
  }
  return stock.close * stock.averageVolume10d;
}

export function atrPct(stock: Stock): number | null {
  if (stock.atr === null || stock.close <= 0) {
    return null;
  }
  return stock.atr / stock.close;
}

export type Sentiment = "positive" | "negative" | "neutral" | "mixed";
export type Relevance = "high" | "medium" | "low";
export type EventType =
  | "result"
  | "contract"
  | "capital_raise"
  | "insider"
  | "acquisition"
  | "dividend"
  | "other";

export interface NewsItem {
  ticker: string;
  issuerName: string;
  title: string;
  publishedAt: Date;
  category: string;
  messageId: number;
  url: string;
  sentiment: Sentiment;
  eventType: EventType;
  relevance: Relevance;
}

export interface NewsSignal {
  sentiment: Sentiment;
  relevance: Relevance;
  eventType: EventType;
  count: number;
  latestTitle: string;
}

export function emptyNewsSignal(): NewsSignal {
  return {
    sentiment: "neutral",
    relevance: "low",
    eventType: "other",
    count: 0,
    latestTitle: "",
  };
}

export function isRelevantSignal(signal: NewsSignal): boolean {
  return signal.count > 0 && (signal.relevance === "high" || signal.relevance === "medium");
}

export function isNegativeSignal(signal: NewsSignal): boolean {
  return signal.sentiment === "negative" || signal.sentiment === "mixed";
}

export const EVENT_LABELS: Record<EventType, string> = {
  result: "Resultat",
  contract: "Kontrakt/ordre",
  capital_raise: "Kapitalinnhenting/emisjon",
  insider: "Innsiderhandel",
  acquisition: "Oppkjøp/strategi",
  dividend: "Utbytte",
  other: "Annet",
};

export const RELEVANCE_LABELS: Record<Relevance, string> = {
  high: "Høy",
  medium: "Middels",
  low: "Lav",
};

export interface Candidate {
  stock: Stock;
  score: number;
  reasons: string[];
  warnings: string[];
  opportunityScore: number;
  riskScore: number;
  categories: string[];
  newsSignal: NewsSignal;
  breakoutStatus: "mulig" | "ikke nær" | "overstrukket";
  technicalUpside: number | null;
  resistance: number | null;
  support: number | null;
  volumeRatio: number | null;
}

export function riskLevel(candidate: Candidate): "Lav" | "Middels" | "Høy" {
  if (candidate.riskScore < 35) {
    return "Lav";
  }
  if (candidate.riskScore < 60) {
    return "Middels";
  }
  return "Høy";
}

export interface TradeScenario {
  changePct: number;
  exitPrice: number;
  grossProfit: number;
  netProfit: number;
  netReturnPct: number;
}

export interface TradePlan {
  capital: number;
  buyFee: number;
  sellFee: number;
  entryPrice: number;
  shares: number;
  invested: number;
  cashLeft: number;
  totalCost: number;
  targetPrice: number;
  targetNet: number;
  targetReturnPct: number;
  /** Effective plan percentage. Optional for reports stored before swing mode. */
  targetPct?: number;
  stopPrice: number;
  stopNet: number;
  stopReturnPct: number;
  /** Effective plan percentage. Optional for reports stored before swing mode. */
  stopPct?: number;
  mode?: TradeMode;
  maxHoldingDays?: number;
  rewardRisk: number | null;
  scenarios: TradeScenario[];
  feasible: boolean;
}

export interface PlannedCandidate {
  candidate: Candidate;
  trade: TradePlan;
  recommendable: boolean;
  blockReasons: string[];
}

export interface Universe {
  stocks: Stock[];
  fetchedAt: Date;
  source: "live" | "cache" | "stale-cache";
  warning: string | null;
  growthTickers: Set<string>;
  growthSource: "live" | "cache" | "stale-cache" | "error" | "ukjent";
  growthWarning: string | null;
}

export interface MarketReport {
  generatedAt: Date;
  universeFetchedAt: Date;
  universeSource: string;
  criteria: import("./screen").Criteria;
  settings: import("./config").Settings;
  ranked: PlannedCandidate[];
  main: PlannedCandidate | null;
  alternatives: PlannedCandidate[];
  blocked: PlannedCandidate[];
  noTradeReason: string | null;
  newsSince: Date | null;
  newsSource: string | null;
  dataBasis: string;
  /** True when the latest scanner price came from an open session. */
  marketOpen: boolean;
  warnings: string[];
}
