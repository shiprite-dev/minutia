"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Decision } from "@/lib/types";
import type { CreateDecisionInput } from "@/lib/schemas";
import { meetingKeys } from "./use-meetings";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------
export const decisionKeys = {
  all: ["decisions"] as const,
  list: (filters: { meetingId?: string; seriesId?: string }) =>
    ["decisions", filters] as const,
};

// ---------------------------------------------------------------------------
// useDecisions - fetch decisions, optionally filtered by meeting or series
// ---------------------------------------------------------------------------
export function useDecisions(meetingId?: string, seriesId?: string) {
  const supabase = createClient();

  return useQuery<Decision[]>({
    queryKey: decisionKeys.list({ meetingId, seriesId }),
    queryFn: async () => {
      let query = supabase
        .from("decisions")
        .select("*")
        .order("created_at", { ascending: false });

      if (meetingId) {
        query = query.eq("meeting_id", meetingId);
      }
      if (seriesId) {
        query = query.eq("series_id", seriesId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Decision[];
    },
  });
}

// ---------------------------------------------------------------------------
// useCreateDecision
// ---------------------------------------------------------------------------
export function useCreateDecision() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: CreateDecisionInput & { meeting_id: string; series_id: string }
    ) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("decisions")
        .insert({
          ...input,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Decision;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: decisionKeys.all });
      queryClient.invalidateQueries({
        queryKey: meetingKeys.detail(variables.meeting_id),
      });
    },
  });
}
