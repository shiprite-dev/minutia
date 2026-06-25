"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { isFeatureGatingEnabled } from "@/lib/feature-access";

export function useAiAccess() {
  const supabase = createClient();

  return useQuery<{ hasAccess: boolean }>({
    queryKey: ["ai-access"],
    queryFn: async () => {
      if (!isFeatureGatingEnabled()) return { hasAccess: true };

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { hasAccess: false };

      const { data, error } = await supabase
        .from("profiles")
        .select("has_full_access")
        .eq("id", user.id)
        .single();

      if (error || !data) return { hasAccess: false };
      return { hasAccess: data.has_full_access === true };
    },
    staleTime: 60_000,
  });
}

export const AI_UNAVAILABLE_MESSAGE =
  "AI features are not enabled for this account.";

// The neutral upsell destination for a nudge slot (instance_config.<slot>_notice_url),
// fetched lazily so it only loads on the gated surfaces that actually render a
// nudge. The OSS build ships no destination; hosted instances configure one.
export function useUpsellNoticeUrl(slot: "ai" | "capacity") {
  return useQuery<{ ctaUrl: string | null }>({
    queryKey: ["upsell-notice-url", slot],
    // Gating off (the OSS default) means nudges never render, so never fetch.
    enabled: isFeatureGatingEnabled(),
    queryFn: async () => {
      const res = await fetch(`/api/ai-notice?slot=${slot}`);
      if (!res.ok) return { ctaUrl: null };
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
}

export function useAiNoticeUrl() {
  return useUpsellNoticeUrl("ai");
}
