import type { Settings } from "./config";
import { daysUntil } from "./dates";
import { formatDateTime, formatMoney, formatPct } from "./format";
import type { NewsFeed } from "./news";
import { marketSession } from "./session";
import { isNegativeSignal } from "./types";
import type { Criteria } from "./screen";
import { rankCandidates } from "./strategy";
import type { Candidate } from "./types";
import { buildTradePlan } from "./trade";
import type { MarketReport, PlannedCandidate, TradePlan, Universe } from "./types";

export { type PlannedCandidate };

function blockReasons(
  candidate: Candidate,
  trade: TradePlan,
  settings: Settings,
  today: string,
): string[] {
  const values: string[] = [];
  const report = settings.report;
  if (candidate.score < report.minTotalScore) {
    values.push(
      `samlet score ${candidate.score.toFixed(0)} < ${report.minTotalScore.toFixed(0)}`,
    );
  }
  if (candidate.opportunityScore < report.minOpportunity) {
    values.push(
      `mulighetsscore ${candidate.opportunityScore.toFixed(0)} < ${report.minOpportunity.toFixed(0)}`,
    );
  }
  if (candidate.riskScore > report.maxRisk) {
    values.push(
      `risikoscore ${candidate.riskScore.toFixed(0)} > ${report.maxRisk.toFixed(0)}`,
    );
  }
  if (!trade.feasible) {
    values.push("ikke nok kapital til én hel aksje etter kurtasje");
  } else if (trade.targetNet <= 0) {
    values.push("gevinstmålet dekker ikke kurtasjen etter kurtasje");
  }
  if (
    trade.rewardRisk !== null &&
    trade.rewardRisk < settings.trade.minRewardRisk
  ) {
    values.push("gevinst/tap-forholdet er for lavt");
  }
  const turnover = candidate.stock.close * (candidate.stock.averageVolume10d ?? 0);
  if (
    candidate.stock.averageVolume10d === null ||
    turnover < report.minTurnover
  ) {
    values.push("likviditeten er under rapportens minstekrav");
  }
  if (candidate.categories.length === 0) {
    values.push("ingen tydelig kategori (momentum, breakout eller nyheter)");
  }
  if (report.blockNegativeNews && isNegativeSignal(candidate.newsSignal)) {
    values.push("negativt nyhetssignal");
  }
  const earnings = daysUntil(candidate.stock.earningsDate, today);
  if (
    earnings !== null &&
    earnings >= 0 &&
    earnings <= report.blockEarningsWithinDays
  ) {
    if (report.blockEarningsWithinDays <= 1) {
      values.push("resultat i dag eller i morgen");
    } else {
      values.push(`resultat innen ${report.blockEarningsWithinDays} dager`);
    }
  }
  const exDate = daysUntil(candidate.stock.exDividendDate, today);
  if (
    exDate !== null &&
    exDate >= 0 &&
    exDate <= report.blockExDateWithinDays
  ) {
    if (report.blockExDateWithinDays === 0) {
      values.push("ex-dato i dag");
    } else {
      values.push(`ex-dato innen ${report.blockExDateWithinDays} dager`);
    }
  }
  return values;
}

export function buildMarketReport(
  stocks: Iterable<unknown>,
  criteria: Criteria,
  universe: Universe,
  news: NewsFeed | null = null,
  settings: Settings,
  today: string,
  now: Date = new Date(),
): MarketReport {
  const stockList = Array.from(stocks as Iterable<import("./types").Stock>);
  const ranked = rankCandidates(
    stockList,
    stockList.length,
    today,
    news,
    settings.scoring,
  );
  const planned: PlannedCandidate[] = ranked.map((candidate) => {
    const trade = buildTradePlan(candidate.stock.close, settings.trade);
    const reasons = blockReasons(candidate, trade, settings, today);
    return {
      candidate,
      trade,
      recommendable: reasons.length === 0,
      blockReasons: reasons,
    };
  });

  const recommendable = planned.filter((item) => item.recommendable);
  const blockedAll = planned.filter((item) => !item.recommendable);
  const main = recommendable.length > 0 ? recommendable[0] : null;
  const alternatives = recommendable
    .filter((item) => item !== main)
    .slice(0, settings.report.maxAlternatives);
  const blocked = blockedAll.slice(0, settings.report.maxAlternatives);
  const selected = [
    ...(main !== null ? [main] : []),
    ...alternatives,
    ...blocked,
  ];

  let noTradeReason: string | null = null;
  if (main === null) {
    if (planned.length === 0) {
      noTradeReason =
        "Ingen anbefalte kandidater i dag – vurder å stå over. " +
        "Ingen aksjer passerte de tekniske kandidatfiltrene.";
    } else {
      const best = planned[0];
      const reason =
        best.blockReasons.length > 0
          ? best.blockReasons.join("; ")
          : "kravene er ikke oppfylt";
      noTradeReason =
        "Ingen anbefalte kandidater i dag – vurder å stå over. " +
        `Beste kandidat er ${best.candidate.stock.ticker}, men ${reason}.`;
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
  if (
    main !== null &&
    main.trade.rewardRisk !== null &&
    main.trade.rewardRisk < 1
  ) {
    warnings.push(
      `Gevinst/tap-forholdet er under 1:1 etter kurtasje. Med ` +
        `${formatMoney(main.trade.capital)} kapital og ` +
        `${formatMoney(main.trade.buyFee + main.trade.sellFee)} i kurtasje ` +
        `spiser kostnadene en stor del av et ` +
        `${formatPct(settings.trade.targetPct, 1, false)} mål; vurder et ` +
        `høyere mål eller la handelen være.`,
    );
  }
  const marketOpen = marketSession(now) === "open";
  const dataBasis =
    `Siste kurs fra TradingView (${formatDateTime(universe.fetchedAt)})` +
    (news !== null
      ? ` og NewsWeb til ${formatDateTime(news.fetchedAt)}`
      : " uten nyhetshenting") +
    ". Score bruker daglige data; kurs og handelsplan bruker siste handlede kurs.";

  return {
    generatedAt: now,
    universeFetchedAt: universe.fetchedAt,
    universeSource: universe.source,
    criteria,
    settings,
    ranked: selected,
    main,
    alternatives,
    blocked,
    noTradeReason,
    newsSince: news !== null ? news.since : null,
    newsSource: news !== null ? news.source : null,
    dataBasis,
    marketOpen,
    warnings,
  };
}

export function newsReason(candidate: Candidate): string {
  const signal = candidate.newsSignal;
  if (signal.count === 0) {
    return "Ingen relevante børsmeldinger i nyhetsvinduet.";
  }
  const labels: Record<string, string> = {
    result: "Resultat",
    contract: "Kontrakt/ordre",
    capital_raise: "Kapitalinnhenting/emisjon",
    insider: "Innsiderhandel",
    acquisition: "Oppkjøp/strategi",
    dividend: "Utbytte",
    other: "Annet",
  };
  const label = labels[signal.eventType] ?? signal.eventType;
  return `${label}: ${signal.latestTitle}`;
}
