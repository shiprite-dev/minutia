"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Meeting } from "@/lib/types";
import type { CreateMeetingInput } from "@/lib/schemas";
import { issueKeys } from "./use-issues";
import { seriesKeys } from "./use-series";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------
export const meetingKeys = {
  all: ["meetings"] as const,
  list: (seriesId: string) => ["meetings", seriesId] as const,
  detail: (id: string) => ["meetings", "detail", id] as const,
};

// ---------------------------------------------------------------------------
// useMeetings - all meetings in a series
// ---------------------------------------------------------------------------
export function useMeetings(seriesId: string) {
  const supabase = createClient();

  return useQuery<Meeting[]>({
    queryKey: meetingKeys.list(seriesId),
    enabled: !!seriesId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("*")
        .eq("series_id", seriesId)
        .order("date", { ascending: false });

      if (error) throw error;
      return data as Meeting[];
    },
  });
}

// ---------------------------------------------------------------------------
// useMeeting - single meeting with issues and decisions
// ---------------------------------------------------------------------------
export function useMeeting(id: string) {
  const supabase = createClient();

  return useQuery<
    Meeting & { issues: import("@/lib/types").Issue[]; decisions: import("@/lib/types").Decision[] }
  >({
    queryKey: meetingKeys.detail(id),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("*, issues:issues!raised_in_meeting_id(*), decisions(*)")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data as any;
    },
  });
}

// ---------------------------------------------------------------------------
// useCreateMeeting - auto-increments sequence via count
// ---------------------------------------------------------------------------
export function useCreateMeeting() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateMeetingInput) => {
      // Get current meeting count in the series for sequence numbering
      const { count, error: countError } = await supabase
        .from("meetings")
        .select("*", { count: "exact", head: true })
        .eq("series_id", input.series_id);

      if (countError) throw countError;

      const { data, error } = await supabase
        .from("meetings")
        .insert({
          ...input,
          status: "upcoming" as const,
          sequence_number: (count ?? 0) + 1,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Meeting;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: meetingKeys.list(variables.series_id),
      });
      queryClient.invalidateQueries({ queryKey: seriesKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// useStartMeeting - set status to 'live'
// ---------------------------------------------------------------------------
export function useStartMeeting() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (meetingId: string) => {
      const { data, error } = await supabase
        .from("meetings")
        .update({ status: "live" as const })
        .eq("id", meetingId)
        .select()
        .single();

      if (error) throw error;
      return data as Meeting;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: meetingKeys.detail(data.id),
      });
      queryClient.invalidateQueries({
        queryKey: meetingKeys.list(data.series_id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// useEndMeeting - set status to 'completed', set completed_at
// ---------------------------------------------------------------------------
// useAllMeetings - recent meetings across all series (for dashboard charts)
// ---------------------------------------------------------------------------
export function useAllMeetings() {
  const supabase = createClient();

  return useQuery<(Meeting & { issues_raised: number; issues_resolved: number })[]>({
    queryKey: [...meetingKeys.all, "dashboard"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("meetings")
        .select("*, series:meeting_series!inner(owner_id), raised_issues:issues!raised_in_meeting_id(count), resolved_issues:issues!resolved_in_meeting_id(count)")
        .eq("series.owner_id", user.id)
        .order("date", { ascending: true })
        .limit(20);

      if (error) throw error;

      return (data ?? []).map((m: any) => ({
        ...m,
        series: undefined,
        issues_raised: m.raised_issues?.[0]?.count ?? 0,
        issues_resolved: m.resolved_issues?.[0]?.count ?? 0,
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// useMeetingsByMonth - all meetings for a calendar month (for sidebar)
// ---------------------------------------------------------------------------
export type MeetingWithSeries = Meeting & { series_name: string; series_id: string };

export function useMeetingsByMonth(year: number, month: number) {
  const supabase = createClient();

  return useQuery<MeetingWithSeries[]>({
    queryKey: [...meetingKeys.all, "month", year, month],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59);

      const { data, error } = await supabase
        .from("meetings")
        .select("*, series:meeting_series!inner(owner_id, name)")
        .eq("series.owner_id", user.id)
        .gte("date", start.toISOString())
        .lte("date", end.toISOString())
        .order("date", { ascending: true });

      if (error) throw error;

      return (data ?? []).map((m: any) => ({
        ...m,
        series_name: m.series?.name ?? "Unknown",
        series: undefined,
      }));
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// useUpdateMeetingNotes - persist notes_markdown
// ---------------------------------------------------------------------------
export function useUpdateMeetingNotes() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ meetingId, notes }: { meetingId: string; notes: string }) => {
      const { error } = await supabase
        .from("meetings")
        .update({ notes_markdown: notes })
        .eq("id", meetingId);

      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: meetingKeys.detail(variables.meetingId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
export function useEndMeeting() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (meetingId: string) => {
      const { data, error } = await supabase
        .from("meetings")
        .update({
          status: "completed" as const,
          completed_at: new Date().toISOString(),
        })
        .eq("id", meetingId)
        .select()
        .single();

      if (error) throw error;
      return data as Meeting;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: meetingKeys.detail(data.id),
      });
      queryClient.invalidateQueries({
        queryKey: meetingKeys.list(data.series_id),
      });
      // Refresh issues since meeting end may affect OIL board
      queryClient.invalidateQueries({ queryKey: issueKeys.all });
    },
  });
}
