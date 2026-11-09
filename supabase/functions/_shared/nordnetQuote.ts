/**
 * Minimal parser for the price block that Nordnet embeds in its public stock
 * pages. The page ships an escaped JSON snapshot, so the object is unescaped
 * before it is parsed.
 */
export interface NordnetPageQuote {
  last: number;
  bid: number | null;
  ask: number | null;
  close: number | null;
  /** ISO timestamp for the last trade, when Nordnet provides one. */
  timestamp: string | null;
}

const PRICE_INFO_MARKERS = ['\\"priceInfo\\":{', '"priceInfo":{'];

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positiveValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function parseNordnetPriceHtml(html: string): NordnetPageQuote | null {
  if (typeof html !== "string" || html.length === 0) {
    return null;
  }

  let markerIndex = -1;
  for (const marker of PRICE_INFO_MARKERS) {
    const index = html.indexOf(marker);
    if (index >= 0) {
      markerIndex = index;
      break;
    }
  }
  if (markerIndex < 0) {
    return null;
  }

  const start = html.indexOf("{", markerIndex);
  const end = html.indexOf("}", start);
  if (start < 0 || end < 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(html.slice(start, end + 1).replace(/\\"/g, '"'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const price = parsed as Record<string, unknown>;
  const last = positiveValue(price.last) ?? positiveValue(price.close);
  if (last === null) {
    return null;
  }

  const rawTimestamp =
    numberValue(price.tradeTimestamp) ?? numberValue(price.timeStamp);
  const timestamp =
    rawTimestamp !== null && rawTimestamp > 0
      ? new Date(rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000)
          .toISOString()
      : null;

  return {
    last,
    bid: numberValue(price.bid),
    ask: numberValue(price.ask),
    close: numberValue(price.close),
    timestamp,
  };
}
