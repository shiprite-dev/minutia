"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  ITEM_LIMIT,
  countActiveIssuesForOrg,
} from "@/lib/hooks/use-issues";
import { useAiAccess } from "@/lib/hooks/use-ai-access";
import { isFeatureGatingEnabled } from "@/lib/feature-access";

export function useIssueLimit() {
  const supabase = createClient();
  const { data: aiAccess } = useAiAccess();
  const hasAccess = aiAccess?.hasAccess ?? false;

  return useQuery<{ activeCount: number; limit: number; atLimit: boolean }>({
    queryKey: ["issue-limit", hasAccess],
    // Only gated instances limit items, and only once the access check has
    // settled: self-host (gating off) is never limited, and a paid user never
    // sees a flash of the limit before useAiAccess resolves.
    enabled: isFeatureGatingEnabled() && aiAccess !== undefined && !hasAccess,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { activeCount: 0, limit: ITEM_LIMIT, atLimit: false };

      const { data: profile } = await supabase
        .from("profiles")
        .select("current_organization_id")
        .eq("id", user.id)
        .single();

      const orgId = profile?.current_organization_id;
      if (!orgId) return { activeCount: 0, limit: ITEM_LIMIT, atLimit: false };

      const count = await countActiveIssuesForOrg(supabase, orgId);
      const activeCount = count ?? 0;
      return {
        activeCount,
        limit: ITEM_LIMIT,
        atLimit: activeCount >= ITEM_LIMIT,
      };
    },
    staleTime: 30_000,
  });
}