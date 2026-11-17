/**
 * Format a Date as `YYYY-MM-DD` using LOCAL calendar fields (never UTC).
 *
 * A date picked from the calendar is a Date at LOCAL midnight. Serializing it
 * with `toISOString()` converts to UTC first, which rolls the date back a day
 * for any timezone ahead of UTC (e.g. IST +5:30: local midnight Jul 10 -> Jul 9
 * 18:30 UTC -> "2026-07-09"). Reading local fields stores the day the user
 * actually clicked.
 */
export function toLocalISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatShortDate(date: Date | string): string {
  return localDay(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function daysBetween(a: Date | string, b: Date | string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round(
    Math.abs(new Date(b).getTime() - new Date(a).getTime()) / msPerDay
  );
}

export function daysSince(date: Date | string): number {
  return daysBetween(date, new Date());
}

export function localDay(date: Date | string): Date {
  if (typeof date === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isDateOverdue(date: Date | string | null): boolean {
  if (!date) return false;
  return localDay(date) < localDay(new Date());
}

export function daysUntil(date: Date | string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round(
    (localDay(date).getTime() - localDay(new Date()).getTime()) / msPerDay
  );
}
