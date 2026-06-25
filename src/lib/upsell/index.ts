// Pure upsell core: neutral, provider-agnostic CTA resolution and the
// dismiss/cooldown gate for nudges. No plan or price logic lives here; the
// destination URL + label come from instance_config at runtime, so a self-host
// instance can point at its own docs while a hosted instance points at upgrade.
// Kept dependency-free so the esbuild contract verifier can bundle it.

export const UPSELL_DEFAULT_CTA_LABEL = "Learn more";

// 14 days: long enough that a dismissed nudge never nags, short enough that it
// returns the next time the user genuinely hits the wall.
export const NUDGE_COOLDOWN_MS = 14 * 86_400_000;

export type UpsellSlot = "ai" | "capacity";

export function resolveUpsellCta(
  url?: string | null,
  label?: string | null,
  defaultLabel: string = UPSELL_DEFAULT_CTA_LABEL,
): { href: string; label: string } | null {
  const href = (url ?? "").trim();
  if (!href) return null;
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  // Only absolute http(s) destinations; never javascript:, data:, etc.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const trimmedLabel = (label ?? "").trim();
  return { href, label: trimmedLabel || defaultLabel };
}

// Whether a nudge should render given its last dismissal. A never-dismissed (or
// corrupt) timestamp shows; a recent dismissal hides until the cooldown elapses.
export function shouldShowNudge(
  dismissedAt: number | null | undefined,
  now: number,
  cooldownMs: number = NUDGE_COOLDOWN_MS,
): boolean {
  if (dismissedAt == null || Number.isNaN(dismissedAt)) return true;
  return now - dismissedAt >= cooldownMs;
}

export function nudgeStorageKey(slot: UpsellSlot): string {
  return `minutia.upsell.${slot}.dismissedAt`;
}
