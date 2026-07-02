"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { applyOptimistic, patch } from "@/lib/optimistic";
import { appendDecision, isListCache } from "@/lib/optimistic-updates";
import type { Decision } from "@/lib/types";
import type { CreateDecisionInput } from "@/lib/schemas";
import { meetingKeys } from "./use-meetings";

/** The meeting-detail cache carries a denormalized decisions array. */
type MeetingWithDecisions = { decisions?: Decision[] } | undefined;

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------
export const decisionKeys = {
  all: ["decisions"] as const,
  list: (filters: { meetingId?: string; seriesId?: string; limit?: number }) =>
    ["decisions", filters] as const,
};

// ---------------------------------------------------------------------------
// useDecisions - fetch decisions, optionally filtered by meeting or series
// ---------------------------------------------------------------------------
export function useDecisions(
  meetingId?: string,
  seriesId?: string,
  enabled = true,
  limit?: number
) {
  const supabase = createClient();

  return useQuery<Decision[]>({
    queryKey: decisionKeys.list({ meetingId, seriesId, limit }),
    enabled,
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
      if (limit !== undefined) {
        query = query.limit(limit);
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

  return useMutation<
    Decision,
    Error,
    CreateDecisionInput & { meeting_id: string; series_id: string },
    { rollback: () => void; tempId: string }
  >({
    mutationFn: async (input) => {
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

    // Append into the live meeting's denormalized decisions immediately so the
    // in-meeting typing loop feels instant. The 2s poll reconciles the real row.
    onMutate: async (input) => {
      const tempId = globalThis.crypto?.randomUUID?.() ?? `optimistic-${Date.now()}`;
      const optimistic = {
        ...input,
        id: tempId,
        created_at: new Date().toISOString(),
      } as unknown as Decision;

      const { rollback } = await applyOptimistic(queryClient, [
        // Live meeting's denormalized blob (the typing loop).
        patch<MeetingWithDecisions>(
          { queryKey: meetingKeys.detail(input.meeting_id) },
          (old) =>
            old ? { ...old, decisions: [optimistic, ...(old.decisions ?? [])] } : old
        ),
        // Standalone decision lists (series detail, palette, dashboard).
        patch<Decision[]>(
          { queryKey: decisionKeys.all, predicate: isListCache },
          appendDecision(optimistic)
        ),
      ]);
      return { rollback, tempId };
    },

    onError: (_err, _vars, context) => context?.rollback(),

    onSuccess: (data, variables, context) => {
      // Swap the temp row for the server row in place (no flicker before poll).
      queryClient.setQueryData<MeetingWithDecisions>(
        meetingKeys.detail(variables.meeting_id),
        (old) =>
          old
            ? {
                ...old,
                decisions: (old.decisions ?? []).map((d) =>
                  d.id === context?.tempId ? data : d
                ),
              }
            : old
      );
    },

    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: decisionKeys.all });
      queryClient.invalidateQueries({
        queryKey: meetingKeys.detail(variables.meeting_id),
      });
    },
  });
}
