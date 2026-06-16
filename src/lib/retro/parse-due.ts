// Best-effort: only resolves explicit ISO date strings to a Date. Free-text
// ("Fri", "next sprint") intentionally stays free-text and returns null, so the
// retro's human due labels survive graduation unchanged.
export function parseDue(input: string): Date | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T00:00:00");
    return isNaN(+d) ? null : d;
  }
  return null;
}
