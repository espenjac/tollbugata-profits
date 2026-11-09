export interface JournalPrefill {
  ticker: string;
  price: number;
  /** ISO timestamp from the buy action. */
  time: string;
}

export function journalPrefillPath(prefill: JournalPrefill): string {
  const params = new URLSearchParams({
    ticker: prefill.ticker.trim().toUpperCase(),
    price: prefill.price.toFixed(2),
    time: prefill.time,
  });
  return `/logg?${params.toString()}`;
}

/**
 * Reads the optional prefilled trade values from a journal URL. Invalid or
 * incomplete values are ignored instead of blocking the journal form.
 */
export function parseJournalPrefill(
  params: URLSearchParams,
): JournalPrefill | null {
  const ticker = (params.get("ticker") ?? "").trim().toUpperCase();
  const priceText = (params.get("price") ?? "").trim().replace(",", ".");
  const price = Number(priceText);
  const timeText = (params.get("time") ?? "").trim();
  if (
    !ticker ||
    !priceText ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !timeText
  ) {
    return null;
  }
  const time = new Date(timeText);
  if (Number.isNaN(time.getTime())) {
    return null;
  }
  return {
    ticker,
    price,
    time: time.toISOString(),
  };
}
