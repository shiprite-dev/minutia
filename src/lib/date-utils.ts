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
