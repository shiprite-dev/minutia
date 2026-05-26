import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { absoluteAppUrl, sendMail } from "@/lib/email";
import { buildMeetingNotesEmail, extractEmails } from "@/lib/meeting-notes-email";
import { createClient } from "@/lib/supabase/server";
import type { Decision, Issue, Meeting, MeetingSeries } from "@/lib/types";

const schema = z.object({
  recipients: z.array(z.string().email()).max(50).optional(),
});

type MeetingPayload = Meeting & {
  series: Pick<MeetingSeries, "id" | "name" | "default_attendees">;
  issues: Issue[];
  decisions: Decision[];
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const { meetingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("*, series:meeting_series!inner(id, name, default_attendees), issues:issues!raised_in_meeting_id(*), decisions(*)")
    .eq("id", meetingId)
    .single();

  if (meetingError || !meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const payload = meeting as MeetingPayload;
  if (payload.status !== "completed") {
    return NextResponse.json(
      { error: "Meeting notes can only be sent after a meeting is completed." },
      { status: 400 }
    );
  }

  const { data: seriesIssues, error: issuesError } = await supabase
    .from("issues")
    .select("*")
    .eq("series_id", payload.series_id);

  if (issuesError) {
    return NextResponse.json({ error: issuesError.message }, { status: 500 });
  }

  const recipients = parsed.data.recipients?.length
    ? parsed.data.recipients
    : extractEmails([...(payload.attendees ?? []), ...(payload.series.default_attendees ?? [])]);

  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "Add at least one attendee email before sending notes." },
      { status: 400 }
    );
  }

  const allIssues = (seriesIssues ?? []) as Issue[];
  const resolvedIssues = allIssues.filter(
    (issue) =>
      issue.resolved_in_meeting_id === meetingId &&
      (issue.status === "resolved" || issue.status === "dropped")
  );
  const raisedIds = new Set((payload.issues ?? []).map((issue) => issue.id));
  const carriedIssues = allIssues.filter(
    (issue) =>
      !raisedIds.has(issue.id) &&
      issue.resolved_in_meeting_id !== meetingId &&
      issue.status !== "resolved" &&
      issue.status !== "dropped"
  );

  const appUrl = absoluteAppUrl(request.url);
  const email = buildMeetingNotesEmail({
    meeting: payload,
    seriesName: payload.series.name,
    raisedIssues: payload.issues ?? [],
    resolvedIssues,
    carriedIssues,
    decisions: payload.decisions ?? [],
    appUrl,
  });

  try {
    await sendMail({
      to: recipients,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send meeting notes" },
      { status: 500 }
    );
  }

  return NextResponse.json({ sent: recipients.length });
}
