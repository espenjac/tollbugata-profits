import slugs from "./nordnet-slugs.json";
import type { Stock } from "./types";

export const NORDNET_BASE = "https://www.nordnet.no/aksjer/kurser/";

const slugMap = new Map<string, string>(
  Object.entries(slugs as Record<string, string>).map(([key, value]) => [
    key.toUpperCase(),
    value,
  ]),
);

const LEGAL_SUFFIXES =
  /\b(asa|as|plc|ltd|limited|ab|n\.?v\.?|inc|corp|corporation)\b\.?/gi;

function guessSlug(stock: Stock): string {
  let name = stock.name.replace(LEGAL_SUFFIXES, " ");
  name = name.replace(/([a-zæøå])([A-ZÆØÅ])/g, "$1 $2");
  name = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (!name) {
    return `${stock.ticker.toLowerCase()}-xosl`;
  }
  return `${name}-${stock.ticker.toLowerCase()}-xosl`;
}

export function nordnetSlug(stock: Stock): string {
  return slugMap.get(stock.ticker.toUpperCase()) ?? guessSlug(stock);
}

export function nordnetUrl(stock: Stock): string {
  return NORDNET_BASE + nordnetSlug(stock);
}

export function nordnetUrlForTicker(ticker: string): string | null {
  const normalized = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(normalized)) {
    return null;
  }
  const knownSlug = slugMap.get(normalized);
  const fallbackSlug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${NORDNET_BASE}${knownSlug ?? `${fallbackSlug}-xosl`}`;
}
