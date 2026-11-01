import { currentSessionOpen, newsWindowStart } from "./dates";
import {
  emptyNewsSignal,
  type EventType,
  type NewsItem,
  type NewsSignal,
  type Relevance,
  type Sentiment,
  type Stock,
} from "./types";

export const NEWS_API_URL = "https://api3.oslo.oslobors.no/v1/newsreader/list";
export const NEWS_MESSAGE_URL = "https://newsweb.oslobors.no/message/{message_id}";

export class NewsSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsSourceError";
  }
}

export interface NewsFeed {
  itemsByTicker: Map<string, NewsItem[]>;
  itemsByName: Map<string, NewsItem[]>;
  fetchedAt: Date;
  since: Date;
  source: "live" | "cache" | "stale-cache" | "error";
  warning: string | null;
  sessionOpen: Date | null;
}

export interface NewsClassification {
  sentiment: Sentiment;
  eventType: EventType;
  relevance: Relevance;
}

const NORWEGIAN_HINTS = [
  " og ",
  " av ",
  " for ",
  " til ",
  " på ",
  " med ",
  " er ",
  " ikke ",
  " ny ",
  " nye ",
  " kvartal",
  " rapport",
  " resultat",
  " avtale",
  " kjøp",
  " salg",
  " oppkjøp",
  " kontrakt",
  " tildelt",
  " leverer",
  " sterk",
  " vekst",
  " utbytte",
  " emisjon",
  " meldepliktig",
  " primærinnsider",
  " nærstående",
  " egne aksjer",
  " ansatt",
];

const POSITIVE_STRONG = [
  String.raw`\brekord`,
  String.raw`\boverskudd`,
  String.raw`\bprofitt`,
  String.raw`\boppkjøp`,
  String.raw`\bkontrakt`,
  String.raw`\btildelt`,
  String.raw`\bsterk`,
  String.raw`\blønnsom`,
  String.raw`\bvekst`,
  String.raw`\bacqui`,
  String.raw`\brecords?\b`,
  String.raw`\bprofit`,
  String.raw`\bcontract`,
  String.raw`\bawarded`,
  String.raw`\bstrong(?:er|est)?\b`,
  String.raw`\bgrowth\b`,
  String.raw`\bbeat\b`,
  String.raw`\braised\b`,
  String.raw`\bupgrade`,
];

const POSITIVE_WEAK = [
  String.raw`\bgod\b`,
  String.raw`\bgode\b`,
  String.raw`\bavtale`,
  String.raw`\bagreement`,
  String.raw`\bkjøp`,
  String.raw`\bpurchase`,
  String.raw`\binngår`,
  String.raw`\bvinner`,
  String.raw`\bwins\b`,
  String.raw`\butbytte`,
  String.raw`\bdividend`,
  String.raw`\bbuyback`,
  String.raw`\brepurchase`,
  String.raw`\bimproved\b`,
  String.raw`\bsolid\b`,
  String.raw`\bexpands\b`,
  String.raw`\bdoubling\b`,
  String.raw`\bordre`,
  String.raw`\border`,
  String.raw`\bbacklog\b`,
];

const NEGATIVE_STRONG = [
  String.raw`\btap\b`,
  String.raw`\bunderskudd`,
  String.raw`\bkutt\b`,
  String.raw`\bkutter`,
  String.raw`\bvarsel`,
  String.raw`\bstreik`,
  String.raw`\bsøksmål`,
  String.raw`\bgransking`,
  String.raw`\betterforskning`,
  String.raw`\bnedgrader`,
  String.raw`\bkonkurs`,
  String.raw`\bnedskrivning`,
  String.raw`\bloss\b`,
  String.raw`\bwarning`,
  String.raw`\blawsuit`,
  String.raw`\binvestigation`,
  String.raw`\bdowngrade`,
  String.raw`\bimpairment`,
  String.raw`\blayoff`,
  String.raw`\bfraud`,
  String.raw`\bplunge`,
];

const NEGATIVE_WEAK = [
  String.raw`\bfall`,
  String.raw`\bnedgang`,
  String.raw`\bsvak`,
  String.raw`\bselger`,
  String.raw`\bsalg\b`,
  String.raw`\bavslutt`,
  String.raw`\bkanseller`,
  String.raw`\butsett`,
  String.raw`\bforsink`,
  String.raw`\bproblem`,
  String.raw`\bfeil\b`,
  String.raw`\bemisjon`,
  String.raw`\bdecline`,
  String.raw`\bweak`,
  String.raw`\bcut\b`,
  String.raw`\bdelay`,
  String.raw`\bterminates`,
  String.raw`\bmiss\b`,
  String.raw`\bdrop\b`,
  String.raw`\blowered`,
  String.raw`\bsenker`,
];

const CAPITAL_RAISE = [
  String.raw`\bemisjon`,
  String.raw`\brettet\s+emisjon`,
  String.raw`\bkapitalinnhenting`,
  String.raw`\bprivate\s+placement`,
  String.raw`\brights?\s+issue`,
  String.raw`\bcapital\s+raise`,
  String.raw`\bshare\s+issue`,
  String.raw`\bny\s+aksjekapital`,
];

const RESULT = [
  String.raw`\bkvartalsrapport`,
  String.raw`\bhalvårsrapport`,
  String.raw`\bårsrapport`,
  String.raw`\bquarterly\s+(?:report|results?)`,
  String.raw`\bannual\s+report`,
  String.raw`\binterim\s+report`,
  String.raw`\bq[1-4]\s*(?:20\d{2}|rapport|report)`,
  String.raw`\bresultat(?:varsel|rapport)?\b`,
];

const CONTRACT = [
  String.raw`\bkontrakt`,
  String.raw`\bcontract`,
  String.raw`\bordre\b`,
  String.raw`\border\b`,
  String.raw`\btildelt`,
  String.raw`\bawarded`,
  String.raw`\bbacklog`,
  String.raw`\bavtale`,
  String.raw`\bagreement`,
];

const INSIDER = [
  String.raw`\bprimærinnsider`,
  String.raw`\binnsider`,
  String.raw`\binsider`,
  String.raw`\bmeldepliktig\s+handel`,
  String.raw`\bmandatory\s+notification\s+of\s+trade`,
];

const ACQUISITION = [
  String.raw`\boppkjøp`,
  String.raw`\bacquisition`,
  String.raw`\bfusjon`,
  String.raw`\bmerger`,
  String.raw`\bdivest`,
  String.raw`\bsalg\s+av\s+virksomhet`,
  String.raw`\bstrategisk`,
  String.raw`\bstrategic`,
];

const DIVIDEND = [
  String.raw`\butbytte`,
  String.raw`\bdividend`,
  String.raw`\bex[- ]?dato`,
  String.raw`\bex[- ]?date`,
];

const LOW_RELEVANCE = [
  String.raw`\bfinancial\s+calendar`,
  String.raw`\bfinansiell\s+kalender`,
  String.raw`\bkalender`,
  String.raw`\bpresentasjon`,
  String.raw`\bpresentation`,
  String.raw`\binvitasjon`,
  String.raw`\binvitation`,
];

function keywordScore(title: string, patterns: string[], weight: number): number {
  return patterns.reduce(
    (score, pattern) => score + (new RegExp(pattern, "i").test(title) ? weight : 0),
    0,
  );
}

function matches(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
}

export function classifySentiment(title: string): Sentiment {
  const text = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "neutral";
  }
  if (/\bprofit\s+warning\b/i.test(text)) {
    return "negative";
  }
  const positive =
    keywordScore(text, POSITIVE_STRONG, 2) + keywordScore(text, POSITIVE_WEAK, 1);
  const negative =
    keywordScore(text, NEGATIVE_STRONG, 2) + keywordScore(text, NEGATIVE_WEAK, 1);
  if (positive >= 2 && positive > negative) {
    return "positive";
  }
  if (negative >= 2 && negative > positive) {
    return "negative";
  }
  return "neutral";
}

export function classifyNews(title: string, category = ""): NewsClassification {
  const text = String(title ?? "").replace(/\s+/g, " ").trim();
  const context = `${text} ${category}`.trim();
  if (!context) {
    return { sentiment: "neutral", eventType: "other", relevance: "low" };
  }

  let sentiment = classifySentiment(text);
  let eventType: EventType = "other";
  let relevance: Relevance = "low";

  if (matches(context, CAPITAL_RAISE)) {
    eventType = "capital_raise";
    relevance = "high";
    sentiment = "negative";
  } else if (/\bprofit\s+warning\b|\bresultatvarsel\b/i.test(context)) {
    eventType = "result";
    relevance = "high";
    sentiment = "negative";
  } else if (matches(context, RESULT)) {
    eventType = "result";
    relevance = "high";
  } else if (matches(context, CONTRACT)) {
    eventType = "contract";
    relevance = matches(context, [
      String.raw`\btildelt`,
      String.raw`\bawarded`,
      String.raw`\bkontrakt`,
      String.raw`\bcontract`,
      String.raw`\bordre\b`,
    ])
      ? "high"
      : "medium";
  } else if (matches(context, INSIDER)) {
    eventType = "insider";
    relevance = "high";
    if (/\bsalg\b|\bselger\b|\bsold\b|\bsale\b/i.test(context)) {
      sentiment = "negative";
    } else if (/\bkjøp\b|\bkjøper\b|\bbought\b|\bpurchase\b/i.test(context)) {
      sentiment = "positive";
    }
  } else if (matches(context, ACQUISITION)) {
    eventType = "acquisition";
    relevance = "high";
  } else if (matches(context, DIVIDEND)) {
    eventType = "dividend";
    relevance = "medium";
  }

  if (matches(context, LOW_RELEVANCE)) {
    relevance = "low";
  }
  if (eventType === "other" && (sentiment === "positive" || sentiment === "negative")) {
    relevance = "medium";
  }

  return { sentiment, eventType, relevance };
}

function tickerKey(value: string): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function nameKey(value: string): string {
  const text = String(value ?? "")
    .toLocaleLowerCase("nb-NO")
    .replace(/\b(asa|as|a\/s|plc|ab|oy|oyj)\b/g, " ");
  return text.replace(/[^a-z0-9æøå]+/g, "");
}

function publishedAt(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const text = value.trim().replace("Z", "+00:00");
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function categoryOf(message: Record<string, unknown>): string {
  const categories = message.category;
  if (!Array.isArray(categories) || categories.length === 0) {
    return "";
  }
  const first = categories[0];
  if (!first || typeof first !== "object") {
    return "";
  }
  const record = first as Record<string, unknown>;
  return String(record.category_no ?? record.category_en ?? "").trim();
}

function cleanTitle(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norwegianScore(title: string): number {
  const text = ` ${title.toLocaleLowerCase("nb-NO")} `;
  let score = NORWEGIAN_HINTS.reduce(
    (sum, hint) => sum + (text.includes(hint) ? 1 : 0),
    0,
  );
  if (/[æøå]/.test(text)) {
    score += 2;
  }
  return score;
}

export function uniqueNews(items: Iterable<NewsItem>, limit?: number): NewsItem[] {
  const best = new Map<string, NewsItem>();
  for (const item of items) {
    const key = `${item.publishedAt.toISOString().slice(0, 16)}|${item.sentiment}|${item.eventType}`;
    const current = best.get(key);
    if (!current || norwegianScore(item.title) > norwegianScore(current.title)) {
      best.set(key, item);
    }
  }
  const ordered = Array.from(best.values()).sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  );
  return limit === undefined ? ordered : ordered.slice(0, limit);
}

export function aggregateSentiment(items: Iterable<NewsItem>): Sentiment {
  const unique = uniqueNews(items);
  const positive = unique.filter((item) => item.sentiment === "positive").length;
  const negative = unique.filter((item) => item.sentiment === "negative").length;
  if (positive > 0 && negative > 0) {
    return "mixed";
  }
  if (positive > 0) {
    return "positive";
  }
  if (negative > 0) {
    return "negative";
  }
  return "neutral";
}

const EVENT_PRIORITY: Record<EventType, number> = {
  capital_raise: 6,
  result: 5,
  contract: 4,
  insider: 3,
  acquisition: 2,
  dividend: 1,
  other: 0,
};

export function aggregateNewsSignal(items: Iterable<NewsItem>): NewsSignal {
  const unique = uniqueNews(items);
  if (unique.length === 0) {
    return emptyNewsSignal();
  }
  const relevanceRank: Record<Relevance, number> = { low: 0, medium: 1, high: 2 };
  const relevance = unique.reduce<Relevance>(
    (best, item) => (relevanceRank[item.relevance] > relevanceRank[best] ? item.relevance : best),
    "low",
  );
  const negative = unique.filter(
    (item) =>
      item.sentiment === "negative" &&
      (item.relevance === "high" || item.relevance === "medium"),
  );
  const candidates = negative.length > 0 ? negative : unique;
  const eventType = candidates.reduce<EventType>(
    (best, item) => (EVENT_PRIORITY[item.eventType] > EVENT_PRIORITY[best] ? item.eventType : best),
    "other",
  );
  return {
    sentiment: aggregateSentiment(unique),
    relevance,
    eventType,
    count: unique.length,
    latestTitle: unique[0].title,
  };
}

export function forStock(feed: NewsFeed, stock: Stock): NewsItem[] {
  return (
    feed.itemsByTicker.get(tickerKey(stock.ticker)) ??
    feed.itemsByName.get(nameKey(stock.name)) ??
    []
  );
}

export function forTicker(feed: NewsFeed, ticker: string): NewsItem[] {
  return feed.itemsByTicker.get(tickerKey(ticker)) ?? [];
}

export function signalFor(feed: NewsFeed, stock: Stock): NewsSignal {
  return aggregateNewsSignal(forStock(feed, stock));
}

export function isNewSinceOpen(feed: NewsFeed, item: NewsItem): boolean {
  return feed.sessionOpen !== null && item.publishedAt >= feed.sessionOpen;
}

export function newCount(feed: NewsFeed, items: Iterable<NewsItem>): number {
  return uniqueNews(items).filter((item) => isNewSinceOpen(feed, item)).length;
}

export function parseNewsPayload(
  payload: unknown,
  since: Date,
  fetchedAt: Date,
  source: "live" | "cache" | "stale-cache" | "error" = "live",
  warning: string | null = null,
): NewsFeed {
  if (!payload || typeof payload !== "object") {
    throw new NewsSourceError("Svar fra NewsWeb mangler 'data'-objektet.");
  }
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== "object") {
    throw new NewsSourceError("Svar fra NewsWeb mangler 'data'-objektet.");
  }
  const messages = (data as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) {
    throw new NewsSourceError("Svar fra NewsWeb mangler 'messages'-listen.");
  }

  let effectiveWarning = warning;
  const byTicker = new Map<string, NewsItem[]>();
  const byName = new Map<string, NewsItem[]>();

  for (const raw of messages) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const message = raw as Record<string, unknown>;
    const ticker = String(message.issuerSign ?? "").trim().toUpperCase();
    if (!ticker) {
      continue;
    }
    const published = publishedAt(message.publishedTime);
    if (!published || published < since) {
      continue;
    }
    const messageId = Number(message.messageId);
    if (!Number.isFinite(messageId)) {
      continue;
    }
    const title = cleanTitle(message.title);
    if (!title) {
      continue;
    }
    const issuerName = cleanTitle(message.issuerName) || ticker;
    const category = categoryOf(message);
    const classification = classifyNews(title, category);
    const item: NewsItem = {
      ticker,
      issuerName,
      title,
      publishedAt: published,
      category,
      messageId,
      url: NEWS_MESSAGE_URL.replace("{message_id}", String(messageId)),
      sentiment: classification.sentiment,
      eventType: classification.eventType,
      relevance: classification.relevance,
    };
    const tKey = tickerKey(ticker);
    const nKey = nameKey(issuerName);
    byTicker.set(tKey, [...(byTicker.get(tKey) ?? []), item]);
    byName.set(nKey, [...(byName.get(nKey) ?? []), item]);
  }

  const sortGroups = (groups: Map<string, NewsItem[]>) =>
    new Map(
      Array.from(groups.entries()).map(([key, items]) => [
        key,
        items.slice().sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()),
      ]),
    );

  if ((data as Record<string, unknown>).overflow && !effectiveWarning) {
    effectiveWarning = "NewsWeb svarte at listen kan være ufullstendig (overflow).";
  }

  return {
    itemsByTicker: sortGroups(byTicker),
    itemsByName: sortGroups(byName),
    fetchedAt,
    since,
    source,
    warning: effectiveWarning,
    sessionOpen: currentSessionOpen(fetchedAt),
  };
}

export function emptyNewsFeed(
  fetchedAt: Date,
  since: Date,
  warning: string | null,
): NewsFeed {
  return {
    itemsByTicker: new Map(),
    itemsByName: new Map(),
    fetchedAt,
    since,
    source: "error",
    warning,
    sessionOpen: currentSessionOpen(fetchedAt),
  };
}

export { newsWindowStart };
