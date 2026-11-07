import { isOsloMarketOpenDay, osloDateString, osloParts } from "./dates";

export type MarketSession = "pre" | "open" | "closed";

/** Oslo Børs is open 09:00–16:30 on trading days (weekdays without holidays). */
export function marketSession(now: Date = new Date()): MarketSession {
  const parts = osloParts(now);
  if (!isOsloMarketOpenDay(osloDateString(now))) {
    return "closed";
  }
  const minutes = parts.hour * 60 + parts.minute;
  if (minutes < 9 * 60) {
    return "pre";
  }
  if (minutes <= 16 * 60 + 30) {
    return "open";
  }
  return "closed";
}

export function marketSessionLabel(session: MarketSession): string {
  switch (session) {
    case "pre":
      return "Før åpning";
    case "open":
      return "Børsen er åpen";
    case "closed":
      return "Børsen er stengt";
  }
}
