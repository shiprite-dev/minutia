"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  ITEM_LIMIT,
  countActiveIssuesForOrg,
} from "@/lib/hooks/use-issues";
import { useAiAccess } from "@/lib/hooks/use-ai-access";

export function useIssueLimit() {
  const supabase = createClient();
  const { data: aiAccess } = useAiAccess();
  const hasAccess = aiAccess?.hasAccess ?? false;

  return useQuery<{ activeCount: number; limit: number; atLimit: boolean }>({
    queryKey: ["issue-limit", hasAccess],
    enabled: !hasAccess,
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