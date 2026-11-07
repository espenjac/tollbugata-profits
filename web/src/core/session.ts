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

/** Give the opening auction a few minutes before the simulator trusts a quote. */
export const SIMULATOR_OPEN_DELAY_MINUTES = 5;

/**
 * True once the Oslo session has been open for the simulator's warm-up delay.
 * The cron job also gates on 09:05 Oslo time; this keeps a manual or retried
 * tick from trading on the previous close at 09:00.
 */
export function simulatorMayTick(now: Date = new Date()): boolean {
  if (marketSession(now) !== "open") {
    return false;
  }
  const parts = osloParts(now);
  return (
    parts.hour * 60 + parts.minute >=
    9 * 60 + SIMULATOR_OPEN_DELAY_MINUTES
  );
}
