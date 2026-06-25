// Neutral, provider-agnostic resolver for the "AI not available" upsell CTA.
// Thin wrapper over the shared pure upsell core: the OSS build never hardcodes a
// destination or any plan or price language; the URL comes from instance_config
// at runtime. Absent or unsafe values render an informational-only notice (no
// CTA). Hosted builds point the configured URL at their own upgrade surface.
import { resolveUpsellCta, UPSELL_DEFAULT_CTA_LABEL } from "@/lib/upsell";

export const AI_NOTICE_DEFAULT_CTA_LABEL = UPSELL_DEFAULT_CTA_LABEL;

export function resolveAiNoticeCta(
  url?: string | null,
  label?: string | null,
): { href: string; label: string } | null {
  return resolveUpsellCta(url, label, AI_NOTICE_DEFAULT_CTA_LABEL);
}
