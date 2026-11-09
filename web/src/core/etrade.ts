import type { Settings } from "./config";
import { daysUntil } from "./dates";
import { formatDateTime } from "./format";
import type { NewsFeed } from "./news";
import { marketSession } from "./session";
import { rankCandidates } from "./strategy";
import { weekendFlag } from "./swing";
import { netTradeResult } from "./trade";
import type { Candidate, Stock, Universe } from "./types";
import { atrPct } from "./types";
import { timeWeightedVolumeRatio } from "./volume";

/**
 * Etrade mode is a faster, chart-driven companion to the swing report.
 *
 * It deliberately stays long-only: the app is used with a Norwegian retail
 * account, and shorting is not part of the product. Every idea is expressed as
 * a breakout/confirmation level ("buy above"), a stop, three profit targets
 * and a level that invalidates the breakout.
 */
export const ETRADE_MAX_HOLDING_DAYS = 3;
export const ETRADE_RUNNER_MAX_HOLDING_DAYS = 10;
export const ETRADE_ATR_STOP_MULTIPLIER = 1;
export const ETRADE_MIN_STOP_PCT = 0.03;
export const ETRADE_MAX_STOP_PCT = 0.05;
export const ETRADE_BREAKOUT_BUFFER = 0.003;
export const ETRADE_MAX_BREAKOUT_CHASE_PCT = 0.05;
export const ETRADE_TARGET_MULTIPLES = [2, 3.5, 5] as const;
export const ETRADE_MAX_IDEAS = 6;
export const ETRADE_MAX_WATCHLIST = 6;

export type EtradeSetup = "breakout" | "pullback" | "momentum" | "news";

export const ETRADE_SETUP_LABELS: Record<EtradeSetup, string> = {
  breakout: "Breakout",
  pullback: "Pullback",
  momentum: "Momentum",
  news: "Nyhetsdrevet",
};

export interface EtradeTarget {
  label: string;
  price: number;
  pct: number;
  net: number;
  netPct: number;
}

export interface EtradeCheck {
  label: string;
  ok: boolean;
}

export interface EtradeIdea {
  candidate: Candidate;
  setup: EtradeSetup;
  setupLabel: string;
  trigger: number;
  invalidation: number | null;
  stopPrice: number;
  stopPct: number;
  stopNet: number;
  shares: number;
  entry: number;
  invested: number;
  totalCost: number;
  cashLeft: number;
  targets: EtradeTarget[];
  rewardRisk: number | null;
  horizonDays: number;
  score: number;
  /** Cumulative volume relative to the normal pace at report time. */
  volumePace: number | null;
  checks: EtradeCheck[];
  blockReasons: string[];
  warnings: string[];
}

export interface EtradeReport {
  generatedAt: Date;
  universeFetchedAt: Date;
  universeSource: string;
  settings: Settings;
  ideas: EtradeIdea[];
  watchlist: EtradeIdea[];
  noIdeaReason: string | null;
  dataBasis: string;
  marketOpen: boolean;
  warnings: string[];
}

/** Partial exits at T1/T2/T3 and the remaining runner, using whole shares. */
export function etradeExitQuantities(shares: number): [number, number, number, number] {
  let remaining = Math.max(0, Math.floor(shares));
  const exits: number[] = [];
  for (let stage = 0; stage < 3; stage += 1) {
    const quantity = remaining === 0
      ? 0
      : remaining === 1
      ? 1
      : Math.max(1, Math.floor(remaining / 2));
    exits.push(quantity);
    remaining -= quantity;
  }
  return [exits[0], exits[1], exits[2], remaining];
}

/** Derive stop/target prices from the actual filled entry, not a stale trigger. */
export function etradeLevelsForEntry(entry: number, stopPct: number): {
  stopPrice: number;
  targets: EtradeTarget[];
} {
  const riskPerShare = entry * stopPct;
  return {
    stopPrice: entry - riskPerShare,
    targets: ETRADE_TARGET_MULTIPLES.map((multiple, index) => ({
      label: `T${index + 1}`,
      price: entry + riskPerShare * multiple,
      pct: riskPerShare * multiple / entry,
      net: 0,
      netPct: 0,
    })),
  };
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function positive(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0;
}

interface Setup {
  setup: EtradeSetup;
  trigger: number;
  invalidation: number | null;
}

/**
 * Invalidation for a breakout must sit below the current price. The level just
 * below the breakout high is only a failure level after the breakout has
 * happened; before that the price is naturally below it, and the simulator
 * would refuse to place the pending order. Fall back to the nearest support
 * when the breakout level is above the last price.
 */
function breakoutInvalidation(
  level: number,
  support: number | null,
  close: number,
): number {
  const levelInvalidation = level * 0.995;
  if (levelInvalidation < close) {
    return levelInvalidation;
  }
  if (positive(support)) {
    const supportInvalidation = support * 0.995;
    if (supportInvalidation < close) {
      return supportInvalidation;
    }
  }
  return close * (1 - ETRADE_BREAKOUT_BUFFER);
}

function chooseSetup(candidate: Candidate): Setup {
  const stock = candidate.stock;
  const close = stock.close;
  const dayHigh = positive(stock.high) ? Math.max(stock.high, close) : close;
  const week = stock.weekReturn ?? 0;
  const rsi = stock.rsi ?? 50;
  const sma5 = positive(stock.sma5) ? stock.sma5 : null;
  const sma20 = positive(stock.sma20) ? stock.sma20 : null;
  const overextended = rsi >= 72 || week >= 0.18;
  const nearSma20 =
    sma20 !== null && close >= sma20 && close / sma20 - 1 <= 0.02;
  const pullbackLevel = nearSma20
    ? Math.max(sma20, positive(stock.vwap) ? stock.vwap : sma20)
    : null;
  const positiveNews =
    candidate.newsSignal.count > 0 &&
    candidate.newsSignal.sentiment === "positive" &&
    candidate.newsSignal.eventType !== "capital_raise";
  const keyHigh = [candidate.resistance, stock.previousDayHigh]
    .filter(
      (level): level is number =>
        positive(level) &&
        Math.abs(level / close - 1) <= ETRADE_MAX_BREAKOUT_CHASE_PCT,
    )
    .sort(
      (left, right) =>
        Math.abs(left / close - 1) - Math.abs(right / close - 1),
    )[0] ?? null;

  if (pullbackLevel !== null && !overextended && rsi < 65) {
    return {
      setup: "pullback",
      trigger: pullbackLevel * (1 + ETRADE_BREAKOUT_BUFFER),
      invalidation: sma20! * 0.995,
    };
  }
  if (positiveNews && !overextended) {
    return {
      setup: "news",
      trigger: dayHigh * (1 + ETRADE_BREAKOUT_BUFFER),
      invalidation: positive(stock.low) ? stock.low * 0.995 : null,
    };
  }
  if (overextended) {
    return {
      setup: "momentum",
      trigger: close * (1 + ETRADE_BREAKOUT_BUFFER),
      invalidation: sma5 !== null && sma5 < close ? sma5 * 0.995 : null,
    };
  }
  if (keyHigh !== null) {
    return {
      setup: "breakout",
      trigger: keyHigh * (1 + ETRADE_BREAKOUT_BUFFER),
      invalidation: breakoutInvalidation(keyHigh, candidate.support, close),
    };
  }
  return {
    setup: "breakout",
    trigger: dayHigh * (1 + ETRADE_BREAKOUT_BUFFER),
    invalidation: breakoutInvalidation(dayHigh, candidate.support, close),
  };
}

function scoreIdea(
  candidate: Candidate,
  setup: EtradeSetup,
  trigger: number,
  volumePace: number | null,
): number {
  const stock = candidate.stock;
  const proximity =
    stock.close > 0
      ? clamp(1 - Math.abs(trigger / stock.close - 1) / 0.06)
      : 0;
  const volume =
    volumePace === null ? 0.35 : clamp((volumePace - 0.5) / 1.5);
  const setupBonus: Record<EtradeSetup, number> = {
    breakout: 8,
    news: 6,
    pullback: 5,
    momentum: 2,
  };
  const overextended =
    (stock.rsi ?? 50) >= 72 || (stock.weekReturn ?? 0) >= 0.18;
  const newsBonus =
    candidate.newsSignal.count > 0 &&
    candidate.newsSignal.sentiment === "positive"
      ? 4
      : 0;
  const base = candidate.score * 0.6 + candidate.opportunityScore * 0.4;
  const raw =
    base +
    setupBonus[setup] +
    10 * volume +
    5 * proximity +
    newsBonus -
    (overextended ? 10 : 0);
  return clamp(raw, 0, 100);
}

function ideaWarnings(
  candidate: Candidate,
  atrKnown: boolean,
  today: string,
  volumePace: number | null,
): string[] {
  const stock = candidate.stock;
  const values: string[] = [];
  if (!atrKnown) {
    values.push(
      "ATR mangler – stoppen bruker 4 % fallback. Kontroller nivået manuelt.",
    );
  }
  if ((stock.rsi ?? 0) >= 75) {
    values.push("RSI over 75 – vent på en kontrollert pause før du kjøper.");
  }
  if ((stock.dayReturn ?? 0) >= 0.05) {
    values.push("Stor dagbevegelse – ikke jag prisen. Vent på trigger og volum.");
  }
  if (volumePace !== null && volumePace < 1) {
    values.push(
      "Volumet er under forventet så langt i dag – krever bekreftelse før inngang.",
    );
  }
  const earnings = daysUntil(stock.earningsDate, today);
  if (earnings !== null && earnings >= 0 && earnings <= 5) {
    values.push(
      `Resultat om ${earnings === 0 ? "i dag" : `${earnings} dager`} – høyere gaprisiko.`,
    );
  }
  if (stock.close < 10) {
    values.push("Lav aksjekurs – større prosentvise utslag og spreadrisiko.");
  }
  return values;
}

function ideaBlockReasons(
  candidate: Candidate,
  setup: EtradeSetup,
  targets: EtradeTarget[],
  rewardRisk: number | null,
  today: string,
  volumePace: number | null,
): string[] {
  const stock = candidate.stock;
  const values: string[] = [];
  if (targets.length === 0 || targets[0].net <= 0) {
    values.push("første mål dekker ikke kurtasjen");
  }
  if (rewardRisk === null || rewardRisk < 1) {
    values.push("gevinst/tap under 1:1 etter kurtasje");
  }
  if (volumePace !== null && volumePace < 0.7) {
    values.push("volumet er under forventet så langt i dag");
  }
  if (stock.rsi !== null && stock.rsi >= 75) {
    values.push("RSI over 75 – overopphetet");
  }
  if ((stock.weekReturn ?? 0) >= 0.2) {
    values.push("uken er svært strukket");
  }
  if ((stock.dayReturn ?? 0) >= 0.08) {
    values.push("stort dagshopp – jag ikke");
  }
  if (
    setup === "breakout" &&
    positive(stock.previousDayHigh) &&
    stock.close > stock.previousDayHigh * (1 + ETRADE_MAX_BREAKOUT_CHASE_PCT)
  ) {
    values.push("kursen er over 5 % over gårsdagens topp – vent på pullback");
  }
  const earnings = daysUntil(stock.earningsDate, today);
  if (earnings !== null && earnings >= 0 && earnings <= 2) {
    values.push("resultat innen 2 dager");
  }
  if (candidate.newsSignal.eventType === "capital_raise") {
    values.push("emisjon/kapitalinnhenting");
  }
  if (
    candidate.newsSignal.count > 0 &&
    candidate.newsSignal.sentiment === "negative"
  ) {
    values.push("negativt nyhetsbilde");
  }
  return values;
}

function buildIdea(
  candidate: Candidate,
  settings: Settings,
  today: string,
  now: Date,
): EtradeIdea | null {
  const stock = candidate.stock;
  if (!Number.isFinite(stock.close) || stock.close <= 0) {
    return null;
  }
  const volumePace = timeWeightedVolumeRatio(candidate.volumeRatio, now);
  const config = settings.trade;
  const setup = chooseSetup(candidate);
  // A historical breakout level may already be below the live price when an
  // idea is first discovered. Keep the trigger anchored to that level, while
  // sizing stops, targets and shares from the price that would actually fill.
  const entry = Math.max(setup.trigger, stock.close) *
    (1 + Math.max(0, config.slippagePct));
  const budget = Math.max(0, config.capital - config.buyFee);
  const shares = Math.floor(budget / entry);
  if (shares <= 0) {
    return null;
  }

  const atr = atrPct(stock);
  const stopPct = clamp(
    (atr ?? 0.04) * ETRADE_ATR_STOP_MULTIPLIER,
    ETRADE_MIN_STOP_PCT,
    ETRADE_MAX_STOP_PCT,
  );
  const levels = etradeLevelsForEntry(entry, stopPct);
  const invested = shares * entry;
  const totalCost = invested + config.buyFee;
  const cashLeft = config.capital - totalCost;
  const exitQuantities = etradeExitQuantities(shares);
  let realizedThroughTarget = 0;
  const targets = levels.targets.map((target, index) => {
    const quantity = exitQuantities[index] ?? 0;
    if (quantity > 0) {
      realizedThroughTarget +=
        quantity * (target.price - entry) -
        (config.buyFee * quantity) / shares -
        config.sellFee;
    }
    return {
      ...target,
      net: realizedThroughTarget,
      netPct: totalCost > 0 ? realizedThroughTarget / totalCost : 0,
    };
  });
  const stopNet = netTradeResult(shares, entry, levels.stopPrice, config);
  const fullExitAtT1Net = targets[0]
    ? netTradeResult(shares, entry, targets[0].price, config)
    : null;
  const rewardRisk =
    stopNet < 0 && fullExitAtT1Net !== null && fullExitAtT1Net > 0
      ? fullExitAtT1Net / Math.abs(stopNet)
      : null;
  const blockReasons = ideaBlockReasons(
    candidate,
    setup.setup,
    targets,
    rewardRisk,
    today,
    volumePace,
  );
  const checks: EtradeCheck[] = [
    {
      label: "Volum over forventet",
      ok: volumePace !== null && volumePace >= 0.8,
    },
    { label: "RSI under 75", ok: (stock.rsi ?? 0) < 75 },
    { label: "Ikke strukket uke", ok: (stock.weekReturn ?? 0) < 0.2 },
    {
      label: "Ingen negativ nyhet",
      ok:
        candidate.newsSignal.eventType !== "capital_raise" &&
        !(
          candidate.newsSignal.count > 0 &&
          candidate.newsSignal.sentiment === "negative"
        ),
    },
    {
      label: "T1 dekker kurtasje",
      ok: targets[0] !== undefined && targets[0].net > 0,
    },
    {
      label: "Minst 1:1 etter kurtasje",
      ok: rewardRisk !== null && rewardRisk >= 1,
    },
  ];

  return {
    candidate,
    setup: setup.setup,
    setupLabel: ETRADE_SETUP_LABELS[setup.setup],
    trigger: setup.trigger,
    invalidation: setup.invalidation,
    stopPrice: levels.stopPrice,
    stopPct,
    stopNet,
    shares,
    entry,
    invested,
    totalCost,
    cashLeft,
    targets,
    rewardRisk,
    horizonDays: ETRADE_MAX_HOLDING_DAYS,
    score: scoreIdea(candidate, setup.setup, setup.trigger, volumePace),
    volumePace,
    checks,
    blockReasons,
    warnings: ideaWarnings(candidate, atr !== null, today, volumePace),
  };
}

export function buildEtradeReport(
  stocks: Iterable<Stock>,
  universe: Universe,
  news: NewsFeed | null,
  settings: Settings,
  today: string,
  now: Date = new Date(),
): EtradeReport {
  const candidates = rankCandidates(
    stocks,
    60,
    today,
    news,
    settings.scoring,
  );
  const all = candidates
    .map((candidate) => buildIdea(candidate, settings, today, now))
    .filter((idea): idea is EtradeIdea => idea !== null)
    .sort((a, b) => b.score - a.score);

  const ideas = all
    .filter((idea) => idea.blockReasons.length === 0)
    .slice(0, ETRADE_MAX_IDEAS);
  const watchlist = all
    .filter((idea) => idea.blockReasons.length > 0)
    .slice(0, ETRADE_MAX_WATCHLIST);

  let noIdeaReason: string | null = null;
  if (ideas.length === 0) {
    if (all.length === 0) {
      noIdeaReason =
        "Ingen aksjer passerte momentum- og likviditetsfiltrene akkurat nå. " +
        "Vent på et tydeligere oppsett i stedet for å tvinge frem en handel.";
    } else {
      const best = all[0];
      noIdeaReason =
        "Ingen ideer passer alle kriteriene nå. " +
        `Beste kandidat er ${best.candidate.stock.ticker}, men ${best.blockReasons.join("; ")}.`;
    }
  }

  const warnings: string[] = [];
  if (universe.warning) {
    warnings.push(universe.warning);
  }
  if (universe.growthWarning) {
    warnings.push(universe.growthWarning);
  }
  if (news !== null && news.warning) {
    warnings.push(news.warning);
  }
  if (ideas.length > 0) {
    const helg = weekendFlag(now);
    if (helg !== null) {
      warnings.push(helg);
    }
  }

  const marketOpen = marketSession(now) === "open";
  const dataBasis =
    `Etrade-ideer fra siste kurs (${formatDateTime(universe.fetchedAt)}). ` +
    "Horisont 1–3 handledager, med runner etter T3 i opptil 10 dager. " +
    "Bruddtrigger bruker nærliggende historisk motstand, " +
    "inkludert forrige dags topp; hvis nivået allerede er brutt vises det som bekreftet. " +
    "Kurs og handelsplan bruker siste handlede kurs.";

  return {
    generatedAt: now,
    universeFetchedAt: universe.fetchedAt,
    universeSource: universe.source,
    settings,
    ideas,
    watchlist,
    noIdeaReason,
    dataBasis,
    marketOpen,
    warnings,
  };
}
