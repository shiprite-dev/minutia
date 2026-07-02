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
  return new Date(date).toLocaleDateString("en-US", {
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

export function isDateOverdue(date: Date | string | null): boolean {
  if (!date) return false;
  return new Date(date) < new Date();
}
