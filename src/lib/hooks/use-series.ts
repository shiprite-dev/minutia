"use client";

import * as React from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { MeetingSeries, SeriesParticipantRole, SeriesWithMeetings } from "@/lib/types";
import type { CreateSeriesInput } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------
export const seriesKeys = {
  all: ["series"] as const,
  detail: (id: string) => ["series", id] as const,
  role: (id: string) => ["series", id, "participant-role"] as const,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// useSeries - all series for the current user with open issue counts
// ---------------------------------------------------------------------------
export function useSeries(enabled = true) {
  const supabase = createClient();

  return useQuery<(MeetingSeries & { open_issues_count: number })[]>({
    queryKey: seriesKeys.all,
    enabled,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("meeting_series")
        .select("*, issues(count)")
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
  const validId = UUID_PATTERN.test(id);

  return useQuery<SeriesWithMeetings | null>({
    queryKey: seriesKeys.detail(id),
    enabled: !!id,
    queryFn: async () => {
      if (!validId) return null;

      const { data, error } = await supabase
        .from("meeting_series")
        .select("*, meetings(*), issues(count)")
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        ...data,
        open_issues_count: (data as any).issues?.[0]?.count ?? 0,
      } as unknown as SeriesWithMeetings;
    },
  });
}

// ---------------------------------------------------------------------------
// useSeriesParticipantRole - current user's role in a series
// ---------------------------------------------------------------------------
export function useSeriesParticipantRole(seriesId: string) {
  const supabase = createClient();

  return useQuery<SeriesParticipantRole | null>({
    queryKey: seriesKeys.role(seriesId),
    enabled: !!seriesId,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("series_participants")
        .select("role")
        .eq("series_id", seriesId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      return (data?.role ?? null) as SeriesParticipantRole | null;
    },
  });
}

// ---------------------------------------------------------------------------
// useSeriesRealtime - refresh series detail when meeting state changes
// ---------------------------------------------------------------------------
export function useSeriesRealtime(seriesId: string) {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!seriesId) return;

    const supabase = createClient();
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: seriesKeys.all });
      void queryClient.invalidateQueries({ queryKey: seriesKeys.detail(seriesId) });
      void queryClient.invalidateQueries({ queryKey: ["meetings", seriesId] });
    };

    const channel = supabase
      .channel(`series:${seriesId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "meeting_series",
          filter: `id=eq.${seriesId}`,
        },
        refresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "meetings",
          filter: `series_id=eq.${seriesId}`,
        },
        refresh
      )
      .subscribe();
    const interval = window.setInterval(refresh, 3000);

    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [queryClient, seriesId]);
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

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("current_organization_id")
        .eq("id", user.id)
        .single();

      if (profileError) throw profileError;

      const { data, error } = await supabase
        .from("meeting_series")
        .insert({
          ...input,
          owner_id: user.id,
          organization_id: profile.current_organization_id,
        })
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
