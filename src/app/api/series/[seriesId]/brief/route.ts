import { NextResponse, type NextRequest } from "next/server";
import { absoluteAppUrl, sendMail } from "@/lib/email";
import { SENDER_NOT_CONFIGURED_MESSAGE } from "@/lib/email-sender";
import { buildSeriesBrief, type BriefIssue } from "@/lib/brief";
import { extractEmails } from "@/lib/meeting-notes-email";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Issue } from "@/lib/types";

function isEmailUnconfigured(message: string): boolean {
  return (
    message === SENDER_NOT_CONFIGURED_MESSAGE ||
    message.toLowerCase().includes("not configured")
  );
}

async function ensureSeriesShareToken(
  admin: ReturnType<typeof createServiceRoleClient>,
  seriesId: string,
  userId: string
): Promise<string> {
  const { data: existing } = await admin
    .from("guest_shares")
    .select("token, expires_at")
    .eq("resource_type", "series")
    .eq("resource_id", seriesId)
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  const now = Date.now();
  const live = (existing ?? []).find(
    (row) => !row.expires_at || new Date(row.expires_at).getTime() > now
  );
  if (live) return live.token;

  const token = crypto.randomUUID();
  const { error } = await admin.from("guest_shares").insert({
    token,
    resource_type: "series",
    resource_id: seriesId,
    permissions: "view",
    created_by: userId,
    expires_at: null,
  });
  if (error) throw new Error(error.message);
  return token;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await params;
  const dryRun = new URL(request.url).searchParams.get("dry") === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: series } = await supabase
    .from("meeting_series")
    .select("id, name, cadence, owner_id, default_attendees")
    .eq("id", seriesId)
    .single();

  if (!series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const admin = createServiceRoleClient();

  const { data: membership } = await admin
    .from("series_participants")
    .select("role")
    .eq("series_id", seriesId)
    .eq("user_id", user.id)
    .maybeSingle();

  const canManage =
    series.owner_id === user.id ||
    membership?.role === "owner" ||
    membership?.role === "facilitator";

  if (!canManage) {
    return NextResponse.json(
      { error: "Only series owners and facilitators can send briefs." },
      { status: 403 }
    );
  }

  const recipients = extractEmails(series.default_attendees ?? []);
  const token = await ensureSeriesShareToken(admin, seriesId, user.id);
  const guestUrl = absoluteAppUrl(request.url, `/share/${token}`);

  if (dryRun) {
    return NextResponse.json({ guestUrl, recipients: recipients.length });
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: "no_recipient_emails", guestUrl }, { status: 422 });
  }

  const { data: seriesIssues } = await admin
    .from("issues")
    .select("*")
    .eq("series_id", seriesId);

  const openIssues = ((seriesIssues ?? []) as Issue[]).filter(
    (issue) => issue.status !== "resolved" && issue.status !== "dropped"
  );
  const ownerIds = [
    ...new Set(
      openIssues.map((issue) => issue.owner_user_id).filter((v): v is string => !!v)
    ),
  ];

  const emailByOwnerId: Record<string, string> = {};
  if (ownerIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email")
      .in("id", ownerIds);
    for (const profile of profiles ?? []) {
      if (profile.email) emailByOwnerId[profile.id] = profile.email;
    }
  }

  const briefIssues: BriefIssue[] = openIssues.map((issue) => ({
    ...issue,
    ownerEmail: issue.owner_user_id ? emailByOwnerId[issue.owner_user_id] ?? null : null,
  }));

  const { data: nextMeetingRow } = await admin
    .from("meetings")
    .select("title, date")
    .eq("series_id", seriesId)
    .in("status", ["upcoming", "live"])
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();

  const briefs = buildSeriesBrief({
    series: { name: series.name, cadence: series.cadence },
    nextMeeting: nextMeetingRow ?? null,
    openIssues: briefIssues,
    recipients,
    guestUrl,
    instanceUrl: absoluteAppUrl(request.url, "/"),
  });

  let sent = 0;
  try {
    for (const brief of briefs) {
      await sendMail({
        to: brief.email,
        subject: brief.subject,
        text: brief.text,
        html: brief.html,
      });
      sent += 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send brief";
    if (sent === 0 && isEmailUnconfigured(message)) {
      return NextResponse.json({ error: "email_unconfigured", guestUrl }, { status: 409 });
    }
    return NextResponse.json({ error: message, sent, guestUrl }, { status: 500 });
  }

  return NextResponse.json({ sent, guestUrl });
}
