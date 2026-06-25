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

// The neutral upsell destination (instance_config.ai_notice_url), fetched lazily
// so it only loads on the gated surfaces that actually render the notice. The OSS
// build ships no destination; hosted instances configure one.
export function useAiNoticeUrl() {
  return useQuery<{ ctaUrl: string | null }>({
    queryKey: ["ai-notice-url"],
    // Gating off (the OSS default) means the notice never renders, so never fetch.
    enabled: isFeatureGatingEnabled(),
    queryFn: async () => {
      const res = await fetch("/api/ai-notice");
      if (!res.ok) return { ctaUrl: null };
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
}
