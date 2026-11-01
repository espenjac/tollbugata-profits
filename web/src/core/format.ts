import { daysUntil, osloDateTimeString } from "./dates";

export const DASH = "–";

function fixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

export function formatPct(
  value: number | null,
  digits = 1,
  signed = true,
): string {
  if (value === null) {
    return DASH;
  }
  let text = fixed(value * 100, digits);
  if (signed && value > 0) {
    text = `+${text}`;
  }
  return `${text} %`;
}

export function formatPrice(value: number | null, digits = 2): string {
  if (value === null) {
    return DASH;
  }
  return fixed(value, digits);
}

export function formatNumber(value: number | null, digits = 0): string {
  if (value === null) {
    return DASH;
  }
  const [whole, fraction] = value.toFixed(digits).split(".");
  const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction === undefined ? withSpaces : `${withSpaces},${fraction}`;
}

export function formatMoney(
  value: number | null,
  digits = 0,
  signed = false,
): string {
  if (value === null) {
    return DASH;
  }
  let text = formatNumber(value, digits);
  if (signed && value > 0) {
    text = `+${text}`;
  }
  return `${text} kr`;
}

export function formatMarketCap(value: number | null): string {
  if (value === null) {
    return DASH;
  }
  const magnitude = Math.abs(value);
  if (magnitude >= 1e12) {
    return `${fixed(value / 1e12, 1)} bill.`;
  }
  if (magnitude >= 1e9) {
    return `${fixed(value / 1e9, 1)} mrd.`;
  }
  if (magnitude >= 1e6) {
    return `${fixed(value / 1e6, 0)} mill.`;
  }
  if (magnitude >= 1e3) {
    return `${fixed(value / 1e3, 0)} k`;
  }
  return fixed(value, 0);
}

export function formatDateTime(value: Date): string {
  return osloDateTimeString(value);
}

export function formatDate(value: string | null): string {
  if (value === null) {
    return DASH;
  }
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export function formatDaysUntil(
  value: string | null,
  today: string,
): string {
  const days = daysUntil(value, today);
  if (days === null || days < 0) {
    return DASH;
  }
  if (days === 0) {
    return "i dag";
  }
  if (days === 1) {
    return "1 dag";
  }
  return `${days} d`;
}
