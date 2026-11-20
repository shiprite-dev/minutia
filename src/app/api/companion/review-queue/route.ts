import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userManagesSeries } from "@/lib/series/manage-access";
import { loadSeriesMembers } from "@/lib/series/members";
import {
  buildReviewQueue,
  type QueueMeetingInput,
  type QueueSuggestion,
} from "@/lib/companion/review-queue";

const WINDOW_DAYS = 14;

const MEETING_COLUMNS =
  "id, series_id, completed_at, transcription_status, suggestions_status, suggestions_reason, suggestions_status_at, meeting_series(name)";

const gone = () =>
  NextResponse.json(
    { error: "This meeting is no longer available.", code: "meeting_gone" },
    { status: 404 },
  );

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const requested = request.nextUrl.searchParams.get("meeting");
  let query = supabase.from("meetings").select(MEETING_COLUMNS);
  if (requested !== null) {
    if (!z.guid().safeParse(requested).success) return gone();
    query = query.eq("id", requested);
  } else {
    const cutoff = new Date(
      Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    query = query
      .gte("completed_at", cutoff)
      .order("completed_at", { ascending: false });
  }
  const { data: meetings, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Couldn't load meetings.", code: "load_failed" },
      { status: 500 },
    );
  }
  if (requested !== null && !meetings?.length) return gone();

  const seriesIds = [...new Set((meetings ?? []).map((m) => m.series_id))];
  const manages = new Map(
    await Promise.all(
      seriesIds.map(
        async (id) => [id, await userManagesSeries(id, user.id)] as const,
      ),
    ),
  );
  const visible = (meetings ?? []).filter(
    (m) => requested !== null || manages.get(m.series_id),
  );
  const meetingIds = visible.map((m) => m.id);

  const { data: pending, error: pendingError } = meetingIds.length
    ? await supabase
        .from("meeting_ai_suggestions")
        .select(
          "id, meeting_id, type, category, title, owner_name, due_date, confidence, related_issue_number, suggested_status",
        )
        .in("meeting_id", meetingIds)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (pendingError) {
    return NextResponse.json(
      { error: "Couldn't load action items.", code: "load_failed" },
      { status: 500 },
    );
  }

  const bySuggestionMeeting = new Map<string, QueueSuggestion[]>();
  for (const s of pending ?? []) {
    const rows = bySuggestionMeeting.get(s.meeting_id) ?? [];
    rows.push(s as QueueSuggestion);
    bySuggestionMeeting.set(s.meeting_id, rows);
  }

  const withRows = visible.filter((m) => bySuggestionMeeting.has(m.id));
  const rowSeriesIds = [...new Set(withRows.map((m) => m.series_id))];
  const members = new Map(
    await Promise.all(
      rowSeriesIds.map(
        async (id) => [id, await loadSeriesMembers(id)] as const,
      ),
    ),
  );

  const titleKeys = withRows.flatMap((m) =>
    (bySuggestionMeeting.get(m.id) ?? []).flatMap((s) =>
      s.type === "status_update" && s.related_issue_number !== null
        ? [s.related_issue_number]
        : [],
    ),
  );
  const titles = new Map<string, string>();
  if (titleKeys.length) {
    const { data: issues } = await supabase
      .from("issues")
      .select("series_id, issue_number, title")
      .in("series_id", rowSeriesIds)
      .in("issue_number", [...new Set(titleKeys)]);
    for (const i of issues ?? [])
      titles.set(`${i.series_id}:${i.issue_number}`, i.title);
  }

  const input: QueueMeetingInput[] = visible.map((m) => {
    const suggestions = bySuggestionMeeting.get(m.id) ?? [];
    const issueTitles: Record<number, string> = {};
    for (const s of suggestions) {
      const title =
        s.related_issue_number !== null
          ? titles.get(`${m.series_id}:${s.related_issue_number}`)
          : undefined;
      if (title) issueTitles[s.related_issue_number!] = title;
    }
    const series = m.meeting_series as unknown as { name: string } | null;
    return {
      meeting_id: m.id,
      series_id: m.series_id,
      series_name: series?.name ?? "",
      ended_at: m.completed_at,
      transcription_status: m.transcription_status,
      suggestions_status: m.suggestions_status,
      suggestions_reason: m.suggestions_reason,
      status_at: m.suggestions_status_at,
      reviewer: manages.get(m.series_id) ?? false,
      suggestions,
      members: members.get(m.series_id) ?? [],
      issueTitles,
    };
  });

  return NextResponse.json(
    buildReviewQueue({
      me: user.id,
      now: new Date(),
      meetings: input,
      mode: requested !== null ? "meeting" : "list",
    }),
  );
}
