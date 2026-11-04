import { osloParts } from "./dates";

export type MarketSession = "pre" | "open" | "closed";

/** Oslo Børs is open 09:00–16:30 on weekdays. */
export function marketSession(now: Date = new Date()): MarketSession {
  const parts = osloParts(now);
  if (parts.weekday === 0 || parts.weekday === 6) {
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
