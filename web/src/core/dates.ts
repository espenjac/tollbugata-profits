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
  if (now < todayOpen) {
    dateString = addDaysToDateString(dateString, -1);
  }
  while (isWeekendDay(weekdayOfDateString(dateString))) {
    dateString = addDaysToDateString(dateString, -1);
  }
  return fromOsloDate(dateString, 9, 0);
}

export function newsWindowStart(now: Date = new Date()): Date {
  let dateString = addDaysToDateString(osloDateString(now), -1);
  while (isWeekendDay(weekdayOfDateString(dateString))) {
    dateString = addDaysToDateString(dateString, -1);
  }
  return fromOsloDate(dateString, 16, 30);
}

export function currentSessionOpen(now: Date = new Date()): Date | null {
  const parts = osloParts(now);
  if (isWeekendDay(parts.weekday)) {
    return null;
  }
  const open = fromOsloDate(osloDateString(now), 9, 0);
  return now >= open ? open : null;
}

export function minutesSince(date: Date, now: Date = new Date()): number {
  return (now.getTime() - date.getTime()) / 60_000;
}
