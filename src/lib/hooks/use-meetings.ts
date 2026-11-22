"use client";

import * as React from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { isPendingDelete } from "@/lib/pending-delete";
import { MEETING_DETAIL_COLUMNS, MEETING_LIST_COLUMNS } from "@/lib/types";
import type { Meeting } from "@/lib/types";
import type { CreateMeetingInput } from "@/lib/schemas";
import { issueKeys } from "./use-issues";
import { seriesKeys } from "./use-series";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------
type MeetingTranscript = Pick<Meeting, "transcript_raw" | "transcript_segments">;

export const meetingKeys = {
  all: ["meetings"] as const,
  list: (seriesId: string) => ["meetings", seriesId] as const,
  detail: (id: string) => ["meetings", "detail", id] as const,
  transcript: (id: string) => ["meetings", "transcript", id] as const,
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
        .select(MEETING_LIST_COLUMNS)
        .eq("series_id", seriesId)
        .order("date", { ascending: false });

      if (error) throw error;
      return data as unknown as Meeting[];
    },
  });
}

// ---------------------------------------------------------------------------
// useMeeting - single meeting with issues and decisions
// ---------------------------------------------------------------------------
export function useMeeting(id: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const fetchTranscript = async () => {
    const { data, error } = await supabase
      .from("meetings")
      .select("transcript_raw, transcript_segments")
      .eq("id", id)
      .single();

    if (error) throw error;
    return data as MeetingTranscript;
  };

  const detail = useQuery<
    Meeting & { issues: import("@/lib/types").Issue[]; decisions: import("@/lib/types").Decision[] }
  >({
    queryKey: meetingKeys.detail(id),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select(`${MEETING_DETAIL_COLUMNS}, issues:issues!raised_in_meeting_id(*), decisions(*)`)
        .eq("id", id)
        .single();

      if (error) throw error;
      // Hide grace-window-deleted issues so the 2s poll cannot resurrect a row
      // the user just deleted while its Undo toast is still up.
      const meeting = data as any;
      // The polled row leaves the transcript out. When the transcription state
      // moves, the new transcript is cached before the new status is returned,
      // so the page never sees a finished status next to the old transcript.
      const previous = queryClient.getQueryData<Meeting>(meetingKeys.detail(id));
      if (
        previous &&
        (previous.transcription_status !== meeting.transcription_status ||
          previous.transcription_completed_at !== meeting.transcription_completed_at)
      ) {
        queryClient.setQueryData(meetingKeys.transcript(id), await fetchTranscript());
      }
      return {
        ...meeting,
        issues: (meeting.issues ?? []).filter(
          (issue: { id: string }) => !isPendingDelete(issue.id)
        ),
      };
    },
  });

  const transcript = useQuery<MeetingTranscript>({
    queryKey: meetingKeys.transcript(id),
    enabled: !!id,
    staleTime: Infinity,
    queryFn: fetchTranscript,
  });

  const data = React.useMemo(
    () => (detail.data && transcript.data ? { ...detail.data, ...transcript.data } : undefined),
    [detail.data, transcript.data]
  );
  return { ...detail, data, isLoading: detail.isLoading || (!!detail.data && !transcript.data) };
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
      queryClient.invalidateQueries({ queryKey: meetingKeys.all });
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
// useStartOrJoinMeeting - atomically starts or joins the one live meeting
// ---------------------------------------------------------------------------
export function useStartOrJoinMeeting() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (seriesId: string) => {
      const { data, error } = await supabase.rpc("start_or_join_meeting", {
        target_series_id: seriesId,
      });

      if (error) throw error;

      const meeting = Array.isArray(data) ? data[0] : data;
      if (!meeting) throw new Error("Meeting was not returned");
      return meeting as Meeting;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      queryClient.invalidateQueries({
        queryKey: meetingKeys.detail(data.id),
      });
      queryClient.invalidateQueries({
        queryKey: meetingKeys.list(data.series_id),
      });
      queryClient.invalidateQueries({
        queryKey: seriesKeys.detail(data.series_id),
      });
      queryClient.invalidateQueries({ queryKey: seriesKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// useMeetingRealtime - live query refresh for meeting collaboration
// ---------------------------------------------------------------------------
const LIVE_POLL_MS = 2_000;
const SETTLED_POLL_MS = 30_000;
const JUST_ENDED_MS = 10 * 60_000;
const RECORDING_WAIT_MS = 60 * 60_000;

export function subscribeMeetingRefresh(
  queryClient: QueryClient,
  meetingId: string,
  seriesId: string
) {
  const supabase = createClient();
  const visible = () => document.visibilityState === "visible";
  const refreshMeeting = () => {
    // Skip a tick while any mutation is in flight so the poll cannot overwrite
    // an optimistic write before it commits; the next tick reconciles.
    if (!visible() || queryClient.isMutating()) return;
    void queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    void queryClient.invalidateQueries({ queryKey: issueKeys.list(seriesId) });
    void queryClient.invalidateQueries({ queryKey: ["decisions"] });
    if (queryClient.getQueryState(meetingKeys.transcript(meetingId))?.status === "error") {
      void queryClient.invalidateQueries({ queryKey: meetingKeys.transcript(meetingId) });
    }
  };
  let rowChangedWhileHidden = false;
  const refreshMeetingRow = () => {
    refreshMeeting();
    if (!visible()) rowChangedWhileHidden = true;
    else void queryClient.invalidateQueries({ queryKey: meetingKeys.transcript(meetingId) });
  };

  // A completed meeting polls slowly only once nothing is on its way: no
  // transcription in flight and no transcript still expected from a recording
  // or a meeting that just ended. Anything else keeps the 2s loop.
  const isSettled = () => {
    const meeting = queryClient.getQueryData<Meeting>(meetingKeys.detail(meetingId));
    const transcript = queryClient.getQueryState<MeetingTranscript>(meetingKeys.transcript(meetingId));
    if (meeting?.status !== "completed" || transcript?.status !== "success") return false;
    if (meeting.transcription_status === "pending" || meeting.transcription_status === "processing") {
      return false;
    }
    if (transcript.data?.transcript_raw?.trim()) return true;
    const sinceEnd = Date.now() - (meeting.completed_at ? Date.parse(String(meeting.completed_at)) : 0);
    const recorded =
      !!meeting.record_claimed_at ||
      !!meeting.recording_started_at ||
      !!meeting.audio_file_path ||
      meeting.transcription_provider === "device";
    return sinceEnd > JUST_ENDED_MS && !(recorded && sinceEnd < RECORDING_WAIT_MS);
  };
  let timer: number | undefined;
  const schedule = () => {
    timer = window.setTimeout(tick, isSettled() ? SETTLED_POLL_MS : LIVE_POLL_MS);
  };
  const tick = () => {
    refreshMeeting();
    schedule();
  };
  // The series detail feeds the Start/Join label, so it refreshes on its own
  // slow clock whatever this meeting's cadence.
  const refreshSeries = () =>
    void queryClient.invalidateQueries({ queryKey: seriesKeys.detail(seriesId), exact: true });
  let seriesTimer: number | undefined;
  const scheduleSeries = () => {
    seriesTimer = window.setTimeout(() => {
      refreshSeries();
      scheduleSeries();
    }, SETTLED_POLL_MS);
  };
  const onVisibilityChange = () => {
    window.clearTimeout(timer);
    window.clearTimeout(seriesTimer);
    if (!visible()) return;
    refreshSeries();
    scheduleSeries();
    if (rowChangedWhileHidden) {
      rowChangedWhileHidden = false;
      refreshMeetingRow();
    } else refreshMeeting();
    schedule();
  };

  const channel = supabase
    .channel(`meeting:${meetingId}:changes`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "meetings", filter: `id=eq.${meetingId}` },
      refreshMeetingRow
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "issues", filter: `series_id=eq.${seriesId}` },
      refreshMeeting
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "decisions", filter: `meeting_id=eq.${meetingId}` },
      refreshMeeting
    )
    .subscribe();
  // Several mutations refresh the meeting only through this loop, so a write
  // reconciles as soon as it settles instead of waiting for the next tick.
  const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
    if (event.type !== "updated") return;
    if (event.action.type === "success" || event.action.type === "error") refreshMeeting();
  });
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (visible()) {
    schedule();
    scheduleSeries();
  }

  return () => {
    window.clearTimeout(timer);
    window.clearTimeout(seriesTimer);
    unsubscribeMutations();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    void supabase.removeChannel(channel);
  };
}

export function useMeetingRealtime(meetingId: string, seriesId: string) {
  const queryClient = useQueryClient();

  // Syncs with Supabase realtime, a poll timer and document visibility.
  React.useEffect(() => {
    if (!meetingId || !seriesId) return;
    return subscribeMeetingRefresh(queryClient, meetingId, seriesId);
  }, [meetingId, queryClient, seriesId]);
}

type PresenceMeta = {
  user_id: string;
  name: string;
  email: string;
  online_at: string;
};

export type MeetingPresenceUser = {
  userId: string;
  name: string;
  email: string;
  deviceCount: number;
};

// ---------------------------------------------------------------------------
// useMeetingPresence - deduplicates the same user across multiple sessions
// ---------------------------------------------------------------------------
export function useMeetingPresence(meetingId: string) {
  const [users, setUsers] = React.useState<MeetingPresenceUser[]>([]);

  React.useEffect(() => {
    if (!meetingId) return;

    const supabase = createClient();
    const channel = supabase.channel(`meeting:${meetingId}:presence`);

    const syncPresence = () => {
      const state = channel.presenceState<PresenceMeta>();
      const nextUsers = Object.entries(state)
        .map(([userId, metas]) => {
          const first = metas[0];
          return {
            userId,
            name: first?.name || first?.email || "Participant",
            email: first?.email || "",
            deviceCount: metas.length,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      setUsers(nextUsers);
    };

    channel.on("presence", { event: "sync" }, syncPresence);
    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("name,email")
        .eq("id", user.id)
        .single();

      await channel.track({
        user_id: user.id,
        name: profile?.name || user.email || "Participant",
        email: profile?.email || user.email || "",
        online_at: new Date().toISOString(),
      });
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meetingId]);

  return users;
}

// ---------------------------------------------------------------------------
// useEndMeeting - set status to 'completed', set completed_at
// ---------------------------------------------------------------------------
// useAllMeetings - recent meetings across all series (for dashboard charts)
// ---------------------------------------------------------------------------
export function useAllMeetings(enabled = true) {
  const supabase = createClient();

  return useQuery<(Meeting & { issues_raised: number; issues_resolved: number })[]>({
    queryKey: [...meetingKeys.all, "dashboard"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select(
          `${MEETING_LIST_COLUMNS}, raised_issues:issues!raised_in_meeting_id(count), resolved_issues:issues!resolved_in_meeting_id(count)`
        )
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

export function useMeetingsByMonth(year: number, month: number, enabled = true) {
  const supabase = createClient();

  return useQuery<MeetingWithSeries[]>({
    queryKey: [...meetingKeys.all, "month", year, month],
    enabled,
    queryFn: async () => {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59);

      const { data, error } = await supabase
        .from("meetings")
        .select(`${MEETING_LIST_COLUMNS}, series:meeting_series!inner(name)`)
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
// useUpdateMeetingNotes - persist notes_markdown and raw_notes_markdown
// ---------------------------------------------------------------------------
export function useUpdateMeetingNotes() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ meetingId, notes }: { meetingId: string; notes: string }) => {
      const { error } = await supabase
        .from("meetings")
        .update({ notes_markdown: notes, raw_notes_markdown: notes })
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
// useUpdateMeetingTranscript - persist a pasted transcript into transcript_raw
// ---------------------------------------------------------------------------
export function useUpdateMeetingTranscript() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ meetingId, transcript }: { meetingId: string; transcript: string }) => {
      const { error } = await supabase
        .from("meetings")
        .update({ transcript_raw: transcript })
        .eq("id", meetingId);

      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: meetingKeys.detail(variables.meetingId),
      });
      queryClient.invalidateQueries({
        queryKey: meetingKeys.transcript(variables.meetingId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateSpeakerMap - correct a diarized speaker; re-flattens transcript_raw
// and re-runs AI extraction server-side, so this hits the API route rather
// than writing the table directly (mirrors runTranscription's fetch pattern).
// ---------------------------------------------------------------------------
export function useUpdateSpeakerMap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      speaker,
      attendee,
    }: {
      meetingId: string;
      speaker: string;
      attendee: string | null;
    }) => {
      const response = await fetch(`/api/meetings/${meetingId}/speaker-map`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker, attendee }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update the speaker.");
      return payload as { speaker_map: Record<string, string | null>; transcript_raw: string };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: meetingKeys.detail(variables.meetingId),
      });
      queryClient.invalidateQueries({
        queryKey: meetingKeys.transcript(variables.meetingId),
      });
    },
    meta: { successMessage: "Speaker renamed." },
  });
}

// ---------------------------------------------------------------------------
// useApplyAiMeetingNotes - explicit apply from preview to visible notes
// ---------------------------------------------------------------------------
export function useApplyAiMeetingNotes() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      notes,
      model,
      promptVersion,
      generatedAt,
    }: {
      meetingId: string;
      notes: string;
      model: string;
      promptVersion: string;
      generatedAt: string;
    }) => {
      const { error } = await supabase
        .from("meetings")
        .update({
          notes_markdown: notes,
          ai_notes_markdown: notes,
          ai_notes_model: model,
          ai_notes_prompt_version: promptVersion,
          ai_notes_generated_at: generatedAt,
        })
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
      queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      queryClient.invalidateQueries({
        queryKey: meetingKeys.detail(data.id),
      });
      queryClient.invalidateQueries({
        queryKey: meetingKeys.list(data.series_id),
      });
      queryClient.invalidateQueries({ queryKey: seriesKeys.detail(data.series_id) });
      // Refresh issues since meeting end may affect OIL board
      queryClient.invalidateQueries({ queryKey: issueKeys.all });
    },
  });
}
