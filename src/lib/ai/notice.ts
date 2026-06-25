// Neutral, provider-agnostic resolver for the "AI not available" upsell CTA.
// The OSS build never hardcodes a destination or any plan or price language; the
// URL comes from instance_config at runtime. Absent or unsafe values render an
// informational-only notice (no CTA). Hosted builds point the configured URL at
// their own upgrade surface.

export const AI_NOTICE_DEFAULT_CTA_LABEL = "Learn more";

export function resolveAiNoticeCta(
  url?: string | null,
  label?: string | null,
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
  return { href, label: trimmedLabel || AI_NOTICE_DEFAULT_CTA_LABEL };
}
