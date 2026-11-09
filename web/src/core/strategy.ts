import type { ScoringConfig } from "./config";
import { daysUntil } from "./dates";
import { formatMarketCap, formatPct } from "./format";
import type { NewsFeed } from "./news";
import { signalFor } from "./news";
import {
  emptyNewsSignal,
  isRelevantSignal,
  type Candidate,
  type NewsSignal,
  type Stock,
  atrPct as stockAtrPct,
  averageTurnover,
} from "./types";

const EPSILON = 1e-9;

export interface ScoringContext {
  medianWeekReturn: number | null;
  medianQuarterReturn: number | null;
}

function clamp(value: number, low = 0, high = 1): number {
  return Math.max(low, Math.min(high, value));
}

function weighted(
  components: Record<string, number>,
  weights: Record<string, number>,
): number {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return 0;
  }
  return (
    Object.entries(components).reduce(
      (sum, [name, value]) => sum + (weights[name] ?? 0) * value,
      0,
    ) / total
  );
}

function weightsOf(weights: object): Record<string, number> {
  return weights as unknown as Record<string, number>;
}

export function isCandidate(stock: Stock, config: ScoringConfig): boolean {
  if (!["stock", "dr"].includes(stock.instrumentType)) {
    return false;
  }
  if (stock.weekReturn === null || stock.weekReturn <= 0) {
    return false;
  }
  if (stock.weekReturn > config.maxWeekReturn) {
    return false;
  }
  if (stock.close < config.minPrice) {
    return false;
  }
  if (stock.sma5 === null || stock.close <= stock.sma5) {
    return false;
  }
  if (stock.sma20 === null || stock.close <= stock.sma20) {
    return false;
  }
  if (stock.monthReturn !== null && stock.monthReturn <= 0) {
    return false;
  }
  if (stock.rsi !== null && stock.rsi > config.maxRsi) {
    return false;
  }
  if (stock.marketCap !== null && stock.marketCap < config.minMarketCap) {
    return false;
  }
  const turnover = averageTurnover(stock);
  if (turnover !== null && turnover < config.minAverageTurnover) {
    return false;
  }
  return true;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildContext(stocks: Stock[]): ScoringContext {
  return {
    medianWeekReturn: median(
      stocks
        .map((stock) => stock.weekReturn)
        .filter((value): value is number => value !== null),
    ),
    medianQuarterReturn: median(
      stocks
        .map((stock) => stock.quarterReturn)
        .filter((value): value is number => value !== null),
    ),
  };
}

function resistance(stock: Stock): number | null {
  const values = [stock.high52w, stock.ath].filter(
    (value): value is number => value !== null && value > stock.close,
  );
  return values.length > 0 ? Math.min(...values) : null;
}

function support(stock: Stock): number | null {
  const values = [stock.sma20, stock.sma5].filter(
    (value): value is number => value !== null && value < stock.close,
  );
  return values.length > 0 ? Math.max(...values) : null;
}

function volumeRatio(stock: Stock): number | null {
  if (
    !stock.volume ||
    !stock.averageVolume10d ||
    stock.averageVolume10d <= 0
  ) {
    return null;
  }
  return stock.volume / stock.averageVolume10d;
}

function dayShare(stock: Stock): number | null {
  const day = stock.dayReturn;
  const week = stock.weekReturn;
  if (day === null || week === null || week <= 0 || day <= 0) {
    return null;
  }
  return day / week;
}

function isSmoothDay(stock: Stock, config: ScoringConfig): boolean {
  const day = stock.dayReturn;
  const share = dayShare(stock);
  return (
    day !== null &&
    day > 0 &&
    day <= config.smoothDayReturn &&
    share !== null &&
    share <= config.smoothDayShare
  );
}

function isDaySpike(stock: Stock, config: ScoringConfig): boolean {
  const day = stock.dayReturn;
  const share = dayShare(stock);
  return (
    day !== null &&
    share !== null &&
    day >= config.spikeDayReturn &&
    share >= config.spikeDayShare
  );
}

function consistencyScore(stock: Stock, config: ScoringConfig): number {
  const day = stock.dayReturn;
  const week = stock.weekReturn;
  if (day === null || week === null || week <= 0) {
    return 0.45;
  }
  if (day <= 0) {
    return 0.65;
  }
  const share = dayShare(stock);
  if (share === null) {
    return 0.45;
  }
  if (isSmoothDay(stock, config)) {
    return 1;
  }
  if (day >= config.strongSpikeDayReturn) {
    return 0;
  }
  if (isDaySpike(stock, config)) {
    const span = Math.max(config.strongSpikeDayReturn - config.spikeDayReturn, EPSILON);
    const ramp = clamp(1 - (day - config.spikeDayReturn) / span);
    return 0.15 + 0.2 * ramp;
  }
  if (day <= config.smoothDayReturn) {
    return 0.75;
  }
  if (day >= config.spikeDayReturn) {
    return 0.45;
  }
  if (share >= 0.75) {
    return 0.55;
  }
  return 0.65;
}

function spikeRisk(
  stock: Stock,
  signal: NewsSignal,
  config: ScoringConfig,
): number {
  const day = stock.dayReturn;
  if (day === null) {
    return 0.2;
  }
  if (day <= 0) {
    return 0;
  }
  const share = dayShare(stock) ?? 0;
  let risk: number;
  if (day >= config.strongSpikeDayReturn) {
    risk = 1;
  } else if (isDaySpike(stock, config)) {
    const span = Math.max(config.strongSpikeDayReturn - config.spikeDayReturn, EPSILON);
    risk = 0.55 + 0.4 * clamp((day - config.spikeDayReturn) / span);
  } else if (day >= config.spikeDayReturn) {
    risk = 0.3;
  } else if (day <= config.smoothDayReturn) {
    risk = share <= config.smoothDayShare ? 0 : 0.1;
  } else {
    risk = 0.15;
  }

  if (risk <= 0) {
    return 0;
  }
  if (stock.rsi !== null && stock.rsi >= config.overextendedRsi) {
    risk = Math.max(risk, 0.7);
  }
  if (
    stock.sma5 !== null &&
    stock.sma5 > 0 &&
    stock.close / stock.sma5 - 1 >= config.spikeSma5Distance
  ) {
    risk = Math.max(risk, 0.6);
  }
  const ratio = volumeRatio(stock);
  const positiveNews =
    isRelevantSignal(signal) &&
    signal.sentiment === "positive" &&
    signal.eventType !== "capital_raise";
  if (positiveNews && ratio !== null && ratio >= 1.5) {
    risk *= 0.8;
  } else if (isRelevantSignal(signal) && signal.sentiment === "negative") {
    risk = Math.min(1, risk + 0.15);
  }
  return clamp(risk);
}

function newsOpportunity(signal: NewsSignal): number {
  if (signal.count === 0) {
    return 0.45;
  }
  if (signal.eventType === "capital_raise") {
    return 0;
  }
  if (signal.sentiment === "negative") {
    return 0;
  }
  if (signal.sentiment === "mixed") {
    return 0.25;
  }
  if (signal.sentiment === "positive") {
    return { high: 0.95, medium: 0.8, low: 0.6 }[signal.relevance] ?? 0.5;
  }
  return { high: 0.55, medium: 0.48, low: 0.4 }[signal.relevance] ?? 0.4;
}

function newsRisk(signal: NewsSignal): number {
  if (signal.eventType === "capital_raise") {
    return 1;
  }
  if (signal.sentiment === "negative") {
    return { high: 1, medium: 0.75, low: 0.4 }[signal.relevance] ?? 0.5;
  }
  if (signal.sentiment === "mixed") {
    return { high: 0.55, medium: 0.4, low: 0.25 }[signal.relevance] ?? 0.3;
  }
  return 0;
}

type BreakoutStatus = "mulig" | "ikke nær" | "overstrukket";

function breakoutStatus(
  stock: Stock,
  config: ScoringConfig,
  _signal: NewsSignal,
): BreakoutStatus {
  const resistanceValue = resistance(stock);
  const week = stock.weekReturn ?? 0;
  const rsi = stock.rsi;
  const overextended =
    week > config.overextendedWeek ||
    (rsi !== null && rsi >= config.overextendedRsi) ||
    isDaySpike(stock, config);
  if (resistanceValue === null) {
    if (overextended || week > 0.1) {
      return "overstrukket";
    }
    return "mulig";
  }
  const distance = resistanceValue / stock.close - 1;
  if (distance <= config.breakoutDistance) {
    return overextended ? "overstrukket" : "mulig";
  }
  return "ikke nær";
}

const CATEGORY_LABELS: Record<string, string> = {
  momentum: "Momentum",
  breakout: "Breakout",
  news: "Nyhetsdrevet",
};

export function categoryLabels(categories: Iterable<string>): string[] {
  return Array.from(categories).map((value) => CATEGORY_LABELS[value] ?? value);
}

function categories(
  stock: Stock,
  config: ScoringConfig,
  signal: NewsSignal,
  status: BreakoutStatus,
): string[] {
  const values: string[] = [];
  const week = stock.weekReturn ?? 0;
  const month = stock.monthReturn;
  const stableMomentum =
    week > 0 &&
    (month === null || month > 0) &&
    stock.sma5 !== null &&
    stock.sma20 !== null &&
    stock.close > stock.sma5 &&
    stock.close > stock.sma20 &&
    week <= config.overextendedWeek &&
    (stock.rsi === null || stock.rsi < config.overextendedRsi) &&
    !isDaySpike(stock, config);
  if (stableMomentum) {
    values.push("momentum");
  }
  if (status === "mulig") {
    values.push("breakout");
  }
  if (
    isRelevantSignal(signal) &&
    signal.sentiment === "positive" &&
    signal.eventType !== "capital_raise"
  ) {
    values.push("news");
  }
  return values;
}

function opportunityComponents(
  stock: Stock,
  context: ScoringContext,
  signal: NewsSignal,
  config: ScoringConfig,
): Record<string, number> {
  const week = stock.weekReturn ?? 0;
  const month = stock.monthReturn;
  let weekScore = clamp(week / 0.08);
  if (week > config.overextendedWeek) {
    weekScore *= Math.max(0.25, 1 - (week - config.overextendedWeek) / 0.1);
  }
  const monthScore = month !== null ? clamp(month / 0.2) : 0.35;
  const momentum = 0.7 * weekScore + 0.3 * monthScore;

  let trend = 0;
  if (stock.sma20 !== null && stock.sma20 > 0) {
    const distance = stock.close / stock.sma20 - 1;
    trend = clamp(distance / 0.08);
    if (distance > 0.12) {
      trend *= Math.max(0.3, 1 - (distance - 0.12) / 0.15);
    }
  }
  if (stock.sma5 !== null && stock.sma20 !== null && stock.sma5 > stock.sma20) {
    trend = clamp(trend + 0.12);
  }
  if (stock.sma50 !== null && stock.close > stock.sma50) {
    trend = clamp(trend + 0.12);
  }

  const quarter = stock.quarterReturn;
  let quarterScore: number;
  if (quarter === null) {
    quarterScore = 0.4;
  } else {
    const base = context.medianQuarterReturn ?? 0;
    quarterScore = clamp(0.5 + (quarter - base) / 0.2);
  }
  const baseWeek = context.medianWeekReturn ?? 0;
  const weekRelative = clamp(0.5 + (week - baseWeek) / 0.1);
  const relativeStrength = 0.6 * quarterScore + 0.4 * weekRelative;

  const turnover = averageTurnover(stock);
  const liquidity =
    turnover !== null && turnover > 0
      ? clamp(Math.log10(turnover / 1_000_000) / 2)
      : 0.3;

  const ratio = volumeRatio(stock);
  let volume: number;
  if (ratio === null) {
    volume = 0.4;
  } else {
    volume = clamp((ratio - 0.4) / 1.2);
    if (ratio > 3) {
      volume *= Math.max(0.4, 1 - (ratio - 3) / 5);
    }
  }

  const resistanceValue = resistance(stock);
  let technicalUpside: number;
  if (resistanceValue === null) {
    technicalUpside = 0.7;
  } else {
    const upside = resistanceValue / stock.close - 1;
    technicalUpside = upside < 0.02 ? 0.45 : clamp(upside / 0.05);
  }

  const atr = stockAtrPct(stock);
  let volatility: number;
  if (atr === null) {
    volatility = 0.4;
  } else {
    volatility =
      1 -
      Math.min(
        Math.abs(atr - config.targetAtrPct) / Math.max(config.targetAtrPct, EPSILON),
        1,
      );
    if (atr > 0.05) {
      volatility *= Math.max(0.2, 1 - (atr - 0.05) / 0.05);
    }
  }

  let breakout = 0;
  let near = resistanceValue === null;
  if (resistanceValue !== null) {
    near = resistanceValue / stock.close - 1 <= config.breakoutDistance;
  }
  const consolidated =
    week >= -0.02 &&
    week <= 0.08 &&
    (atr === null || atr <= 0.04) &&
    stock.sma20 !== null &&
    stock.close > stock.sma20;
  const volumeSupport = ratio !== null && ratio >= 0.8 && ratio <= 2.5;
  breakout =
    (near ? 0.4 : 0) +
    (consolidated ? 0.3 : 0) +
    (volumeSupport ? 0.3 : 0);
  if (
    week > config.overextendedWeek ||
    (stock.rsi !== null && stock.rsi >= config.overextendedRsi) ||
    isDaySpike(stock, config)
  ) {
    breakout *= 0.25;
  }

  return {
    momentum,
    trend,
    relativeStrength,
    liquidity,
    volume,
    technicalUpside,
    volatility,
    news: newsOpportunity(signal),
    breakout,
    consistency: consistencyScore(stock, config),
  };
}

function riskComponents(
  stock: Stock,
  signal: NewsSignal,
  today: string,
  config: ScoringConfig,
): Record<string, number> {
  const atr = stockAtrPct(stock);
  const volatility = atr === null ? 0.5 : clamp((atr - 0.015) / 0.055);

  const week = stock.weekReturn ?? 0;
  const overextensionValues = [clamp((week - 0.1) / 0.15)];
  if (stock.rsi !== null) {
    overextensionValues.push(clamp((stock.rsi - 65) / 20));
  }
  if (stock.sma20 !== null && stock.sma20 > 0) {
    overextensionValues.push(
      clamp((stock.close / stock.sma20 - 1 - 0.08) / 0.15),
    );
  }
  if (stock.monthReturn !== null) {
    overextensionValues.push(clamp((stock.monthReturn - 0.3) / 0.2));
  }
  const overextension = Math.max(...overextensionValues);

  const turnover = averageTurnover(stock);
  let liquidity: number;
  if (turnover === null) {
    liquidity = 0.6;
  } else if (turnover < config.minAverageTurnover) {
    liquidity = 1;
  } else if (turnover < 10_000_000) {
    liquidity = 0.7;
  } else if (turnover < 30_000_000) {
    liquidity = 0.4;
  } else if (turnover < 100_000_000) {
    liquidity = 0.15;
  } else {
    liquidity = 0;
  }

  let event = 0;
  const earnings = daysUntil(stock.earningsDate, today);
  if (earnings !== null && earnings >= 0 && earnings <= 7) {
    event = Math.max(
      event,
      { 0: 1, 1: 0.85, 2: 0.55, 3: 0.35 }[earnings] ?? 0.15,
    );
  }
  const exDate = daysUntil(stock.exDividendDate, today);
  if (exDate !== null && exDate >= 0 && exDate <= 1) {
    event = Math.max(event, exDate === 0 ? 0.5 : 0.3);
  }

  const cap = stock.marketCap;
  let marketCap: number;
  if (cap === null) {
    marketCap = 0.3;
  } else if (cap < 300_000_000) {
    marketCap = 1;
  } else if (cap < 1_000_000_000) {
    marketCap = 0.65;
  } else if (cap < 3_000_000_000) {
    marketCap = 0.35;
  } else if (cap < 10_000_000_000) {
    marketCap = 0.1;
  } else {
    marketCap = 0;
  }

  const price = stock.close;
  let priceRisk: number;
  if (price < 10) {
    priceRisk = 1;
  } else if (price < 20) {
    priceRisk = 0.65;
  } else if (price < 50) {
    priceRisk = 0.25;
  } else if (price < 100) {
    priceRisk = 0.1;
  } else {
    priceRisk = 0;
  }

  return {
    volatility,
    overextension,
    spike: spikeRisk(stock, signal, config),
    liquidity,
    event,
    negativeNews: newsRisk(signal),
    marketCap,
    price: priceRisk,
  };
}

function signedPoints(value: number): string {
  const text = `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
  return `${text.replace(".", ",")} %`;
}

function reasons(stock: Stock, config: ScoringConfig): string[] {
  const values = [`Uke ${formatPct(stock.weekReturn)}`];
  if (stock.dayReturn !== null) {
    values.push(`Dag ${formatPct(stock.dayReturn)}`);
  }
  values.push(`Måned ${formatPct(stock.monthReturn)}`);
  if (isSmoothDay(stock, config)) {
    values.push("Jevn uke");
  }
  if (stock.sma20) {
    values.push(`${signedPoints((stock.close / stock.sma20 - 1) * 100)} over SMA20`);
  }
  if (stock.rsi !== null) {
    values.push(`RSI ${stock.rsi.toFixed(0)}`);
  }
  if (averageTurnover(stock) !== null) {
    values.push(`${formatMarketCap(averageTurnover(stock))}/dag`);
  }
  const atr = stockAtrPct(stock);
  if (atr !== null) {
    values.push(`ATR ${(atr * 100).toFixed(1).replace(".", ",")} %`);
  }
  return values;
}

function warnings(
  stock: Stock,
  signal: NewsSignal,
  today: string,
  status: BreakoutStatus,
  config: ScoringConfig,
): string[] {
  const values: string[] = [];
  const day = stock.dayReturn;
  const share = dayShare(stock);
  if (day !== null && day >= config.strongSpikeDayReturn) {
    values.push(`Stort dagshopp ${formatPct(day)} – svært høy jagrisiko`);
  } else if (isDaySpike(stock, config)) {
    const shareText =
      share !== null && share !== 0
        ? ` (${(share * 100).toFixed(0)} % av uken)`
        : "";
    const positiveNews =
      isRelevantSignal(signal) &&
      signal.sentiment === "positive" &&
      signal.eventType !== "capital_raise";
    if (positiveNews) {
      values.push(
        `Stort dagshopp ${formatPct(day)}${shareText} – mulig nyhetsdrevet, vent på pullback`,
      );
    } else {
      values.push(
        `Stort dagshopp ${formatPct(day)}${shareText} – vent på pullback`,
      );
    }
  } else if (day !== null && day >= config.spikeDayReturn) {
    values.push(`Stor enkeltdag ${formatPct(day)} – sjekk nyhet og volum`);
  }

  const earnings = daysUntil(stock.earningsDate, today);
  if (earnings === 0) {
    values.push("Resultat i dag");
  } else if (earnings === 1) {
    values.push("Resultat i morgen");
  } else if (earnings !== null && earnings >= 2 && earnings <= 7) {
    values.push(`Resultat om ${earnings} dager`);
  }

  const exDate = daysUntil(stock.exDividendDate, today);
  if (exDate === 0) {
    values.push("Ex-dato i dag");
  } else if (exDate === 1) {
    values.push("Ex-dato i morgen");
  }

  if (stock.rsi !== null && stock.rsi >= 75) {
    values.push("RSI over 75 – overopphetet");
  }
  if ((stock.weekReturn ?? 0) > 0.15) {
    values.push("Sterk uke – fare for pause");
  }
  if (status === "overstrukket") {
    values.push("Nær høy, men allerede strukket");
  }
  if (stock.close < 10) {
    values.push("Lav aksjekurs – større prosentvise bevegelser");
  }
  const turnover = averageTurnover(stock);
  if (turnover === null) {
    values.push("Likviditet ukjent");
  } else if (turnover < 10_000_000) {
    values.push("Lav likviditet");
  }
  if (stock.marketCap !== null && stock.marketCap < 1_000_000_000) {
    values.push("Liten markedsverdi");
  }
  if (stock.monthReturn === null) {
    values.push("Månedstrend mangler");
  }
  if (signal.eventType === "capital_raise") {
    values.push("Emisjon/kapitalinnhenting – utvanningsrisiko");
  } else if (signal.sentiment === "negative" && isRelevantSignal(signal)) {
    values.push("Negativ nyhet – sjekk kilden");
  } else if (signal.sentiment === "mixed" && isRelevantSignal(signal)) {
    values.push("Blandet nyhetsbilde");
  }
  return values;
}

function buildCandidate(
  stock: Stock,
  context: ScoringContext,
  signal: NewsSignal,
  today: string,
  config: ScoringConfig,
): Candidate {
  const opportunityComponentsValue = opportunityComponents(stock, context, signal, config);
  const riskComponentsValue = riskComponents(stock, signal, today, config);
  const opportunity =
    100 * weighted(opportunityComponentsValue, weightsOf(config.weights));
  const risk = 100 * weighted(riskComponentsValue, weightsOf(config.riskWeights));
  const score = clamp(opportunity * (1 - (config.riskPenalty * risk) / 100), 0, 100);
  const status = breakoutStatus(stock, config, signal);
  const resistanceValue = resistance(stock);
  const supportValue = support(stock);
  const upside = resistanceValue !== null ? resistanceValue / stock.close - 1 : null;
  return {
    stock,
    score,
    reasons: reasons(stock, config),
    warnings: warnings(stock, signal, today, status, config),
    opportunityScore: opportunity,
    riskScore: risk,
    categories: categories(stock, config, signal, status),
    newsSignal: signal,
    breakoutStatus: status,
    technicalUpside: upside,
    resistance: resistanceValue,
    support: supportValue,
    volumeRatio: volumeRatio(stock),
  };
}

export function rankCandidates(
  stocks: Iterable<Stock>,
  limit = 5,
  today: string,
  news: NewsFeed | null = null,
  config: ScoringConfig,
): Candidate[] {
  const items = Array.from(stocks);
  const context = buildContext(items);
  const candidates = items
    .filter((stock) => isCandidate(stock, config))
    .map((stock) =>
      buildCandidate(
        stock,
        context,
        news !== null ? signalFor(news, stock) : emptyNewsSignal(),
        today,
        config,
      ),
    );
  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.riskScore !== b.riskScore) {
      return a.riskScore - b.riskScore;
    }
    if (b.opportunityScore !== a.opportunityScore) {
      return b.opportunityScore - a.opportunityScore;
    }
    if ((b.stock.weekReturn ?? 0) !== (a.stock.weekReturn ?? 0)) {
      return (b.stock.weekReturn ?? 0) - (a.stock.weekReturn ?? 0);
    }
    return a.stock.ticker.localeCompare(b.stock.ticker);
  });
  return candidates.slice(0, Math.max(0, limit));
}
