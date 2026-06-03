"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { issueKeys } from "@/lib/hooks/use-issues";
import type { IssueWithUpdates } from "@/lib/types";

async function fetchIssueDetail(issueId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("issues")
    .select("*, updates:issue_updates(*), raised_in_meeting:meetings!raised_in_meeting_id(*)")
    .eq("id", issueId)
    .single();

  if (error) throw error;
  return data as unknown as IssueWithUpdates;
}

export function usePrefetchIssueDetail() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return React.useCallback(
    (issueId: string) => {
      router.prefetch(`/issues/${issueId}`);
      void queryClient.prefetchQuery({
        queryKey: issueKeys.detail(issueId),
        queryFn: () => fetchIssueDetail(issueId),
        staleTime: 60 * 1000,
      });
    },
    [queryClient, router]
  );
}
