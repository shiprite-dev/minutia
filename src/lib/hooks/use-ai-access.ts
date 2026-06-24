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
