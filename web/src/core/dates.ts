import { fromZonedTime } from "date-fns-tz";

export const OSLO_TIME_ZONE = "Europe/Oslo";

const osloDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: OSLO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const osloDateTimeFormatter = new Intl.DateTimeFormat("nb-NO", {
  timeZone: OSLO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function osloDateString(value: Date = new Date()): string {
  return osloDateFormatter.format(value);
}

export function osloDateTimeString(value: Date): string {
  return osloDateTimeFormatter.format(value);
}

export function osloParts(value: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OSLO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: weekdays[get("weekday")] ?? 0,
  };
}

export function fromOsloDate(
  dateString: string,
  hour: number,
  minute: number,
): Date {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return fromZonedTime(`${dateString}T${hh}:${mm}:00`, OSLO_TIME_ZONE);
}

export function addDaysToDateString(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function weekdayOfDateString(dateString: string): number {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isWeekendDay(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

// Oslo Børs is closed on these fixed dates every year. Christmas Eve and New
// Year's Eve are full closures for Oslo (unlike several other Euronext venues,
// which only close early).
const FIXED_MARKET_HOLIDAYS = new Set([
  "01-01", // New Year's Day
  "05-01", // Labour Day
  "05-17", // Constitution Day
  "12-24", // Christmas Eve
  "12-25", // Christmas Day
  "12-26", // Boxing Day
  "12-31", // New Year's Eve
]);

/** Movable feasts are counted as days from Easter Sunday. */
const EASTER_MARKET_HOLIDAYS = new Set([
  -3, // Maundy Thursday
  -2, // Good Friday
  1, // Easter Monday
  39, // Ascension Day
  50, // Whit Monday
]);

/** Easter Sunday in the Gregorian calendar (Meeus/Jones/Butcher). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** True when Oslo Børs is closed for a public holiday on this date. */
export function isOsloMarketHoliday(dateString: string): boolean {
  const [year, month, day] = dateString.split("-").map(Number);
  const key = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (FIXED_MARKET_HOLIDAYS.has(key)) {
    return true;
  }
  const easter = easterSunday(year);
  const easterUtc = Date.UTC(year, easter.month - 1, easter.day);
  const dateUtc = Date.UTC(year, month - 1, day);
  const daysFromEaster = Math.round((dateUtc - easterUtc) / 86_400_000);
  return EASTER_MARKET_HOLIDAYS.has(daysFromEaster);
}

/** True when Oslo Børs has a trading day on this date. */
export function isOsloMarketOpenDay(dateString: string): boolean {
  if (isWeekendDay(weekdayOfDateString(dateString))) {
    return false;
  }
  return !isOsloMarketHoliday(dateString);
}

export function daysUntil(dateString: string | null, today: string): number | null {
  if (dateString === null) {
    return null;
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const current = Date.UTC(todayYear, todayMonth - 1, todayDay);
  return Math.round((target - current) / 86_400_000);
}

export function lastMarketOpen(now: Date = new Date()): Date {
  let dateString = osloDateString(now);
  const todayOpen = fromOsloDate(dateString, 9, 0);
  if (now < todayOpen || !isOsloMarketOpenDay(dateString)) {
    dateString = addDaysToDateString(dateString, -1);
  }
  while (!isOsloMarketOpenDay(dateString)) {
    dateString = addDaysToDateString(dateString, -1);
  }
  return fromOsloDate(dateString, 9, 0);
}

export function newsWindowStart(now: Date = new Date()): Date {
  let dateString = addDaysToDateString(osloDateString(now), -1);
  while (!isOsloMarketOpenDay(dateString)) {
    dateString = addDaysToDateString(dateString, -1);
  }
  return fromOsloDate(dateString, 16, 30);
}

export function currentSessionOpen(now: Date = new Date()): Date | null {
  if (!isOsloMarketOpenDay(osloDateString(now))) {
    return null;
  }
  const open = fromOsloDate(osloDateString(now), 9, 0);
  return now >= open ? open : null;
}

export function minutesSince(date: Date, now: Date = new Date()): number {
  return (now.getTime() - date.getTime()) / 60_000;
}
