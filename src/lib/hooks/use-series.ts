"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { MeetingSeries, SeriesWithMeetings } from "@/lib/types";
import type { CreateSeriesInput } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------
export const seriesKeys = {
  all: ["series"] as const,
  detail: (id: string) => ["series", id] as const,
};

// ---------------------------------------------------------------------------
// useSeries - all series for the current user with open issue counts
// ---------------------------------------------------------------------------
export function useSeries() {
  const supabase = createClient();

  return useQuery<(MeetingSeries & { open_issues_count: number })[]>({
    queryKey: seriesKeys.all,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("meeting_series")
        .select("*, issues(count)")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) throw error;

      // Map the aggregated count into a flat field
      return (data ?? []).map((s: any) => ({
        ...s,
        open_issues_count: s.issues?.[0]?.count ?? 0,
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// useSeriesDetail - single series with its meetings
// ---------------------------------------------------------------------------
export function useSeriesDetail(id: string) {
  const supabase = createClient();

  return useQuery<SeriesWithMeetings>({
    queryKey: seriesKeys.detail(id),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_series")
        .select("*, meetings(*), issues(count)")
        .eq("id", id)
        .single();

      if (error) throw error;

      return {
        ...data,
        open_issues_count: (data as any).issues?.[0]?.count ?? 0,
      } as unknown as SeriesWithMeetings;
    },
  });
}

// ---------------------------------------------------------------------------
// useCreateSeries
// ---------------------------------------------------------------------------
export function useCreateSeries() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateSeriesInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("meeting_series")
        .insert({ ...input, owner_id: user.id })
        .select()
        .single();

      if (error) throw error;
      return data as MeetingSeries;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seriesKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateSeries
// ---------------------------------------------------------------------------
export function useUpdateSeries() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: Partial<CreateSeriesInput> & { id: string }) => {
      const { data, error } = await supabase
        .from("meeting_series")
        .update(input)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as MeetingSeries;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: seriesKeys.all });
      queryClient.invalidateQueries({
        queryKey: seriesKeys.detail(variables.id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// useDeleteSeries
// ---------------------------------------------------------------------------
export function useDeleteSeries() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("meeting_series")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seriesKeys.all });
    },
  });
}
