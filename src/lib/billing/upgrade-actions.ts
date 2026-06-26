// Shared client-side action for initiating the upgrade flow. Both the
// AI-unavailable notice and the capacity nudge import from here so the fetch
// logic, error signaling, and redirect are defined exactly once.
//
// Returns true when the redirect is triggered (window.location.assign called)
// and false on any error (non-OK response, missing URL, or network failure),
// giving callers a chance to surface feedback to the user rather than silently
// dropping the failure.
export async function startUpgrade(): Promise<boolean> {
  try {
    const res = await fetch("/api/billing/upgrade-link", { method: "POST" });
    if (!res.ok) return false;
    const data = (await res.json()) as { url?: string };
    if (!data.url) return false;
    window.location.assign(data.url);
    return true;
  } catch {
    return false;
  }
}
