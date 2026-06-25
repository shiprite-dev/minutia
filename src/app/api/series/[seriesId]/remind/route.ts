import { NextResponse, type NextRequest } from "next/server";
import { absoluteAppUrl, getSmtpConfig, sendMail } from "@/lib/email";
import { getInstanceConfigMap } from "@/lib/instance-config";
import {
  buildSlackMessage,
  buildWebhookPayload,
  formatOwnerEmail,
  formatReminderDigest,
  gatherOwnerReminders,
  resolveReminderChannel,
  type ReminderContext,
  type ReminderProfile,
} from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Issue } from "@/lib/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ seriesId: string }> }
) {
  const { seriesId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: series } = await supabase
    .from("meeting_series")
    .select("id, name, owner_id")
    .eq("id", seriesId)
    .single();

  if (!series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const admin = createServiceRoleClient();

  // Reminders gather every owner's email across the series, so the trigger is
  // restricted to those who manage it (owner/facilitator), mirroring the UI
  // gate. Keyed on the requesting user's own id via service-role to avoid RLS
  // false-negatives on the membership lookup.
  const { data: membership } = await admin
    .from("series_participants")
    .select("role")
    .eq("series_id", seriesId)
    .eq("user_id", user.id)
    .maybeSingle();

  const canRemind =
    series.owner_id === user.id ||
    membership?.role === "owner" ||
    membership?.role === "facilitator";

  if (!canRemind) {
    return NextResponse.json(
      { error: "Only series owners and facilitators can send reminders." },
      { status: 403 }
    );
  }

  const { data: seriesIssues } = await admin
    .from("issues")
    .select("*")
    .eq("series_id", seriesId);

  const issues = (seriesIssues ?? []) as Issue[];
  const ownerIds = [
    ...new Set(
      issues.map((issue) => issue.owner_user_id).filter((v): v is string => !!v)
    ),
  ];

  const profilesById: Record<string, ReminderProfile> = {};
  if (ownerIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, name")
      .in("id", ownerIds);
    for (const profile of profiles ?? []) {
      profilesById[profile.id] = { email: profile.email, name: profile.name };
    }
  }

  const owners = gatherOwnerReminders(issues, profilesById);
  if (owners.length === 0) {
    return NextResponse.json(
      { error: "No open issues to remind about." },
      { status: 400 }
    );
  }

  const [smtp, configMap] = await Promise.all([
    getSmtpConfig(),
    getInstanceConfigMap(["slack_webhook_url", "reminder_webhook_url"]),
  ]);

  const slackWebhookUrl = configMap.slack_webhook_url;
  const reminderWebhookUrl = configMap.reminder_webhook_url;
  const channel = resolveReminderChannel({
    smtpConfigured: smtp !== null,
    resendConfigured: !!process.env.RESEND_API_KEY,
    slackWebhookUrl,
    reminderWebhookUrl,
  });

  const appUrl = absoluteAppUrl(request.url, `/series/${seriesId}`);
  const ctx: ReminderContext = { seriesName: series.name, appUrl };

  try {
    let sent = 0;

    if (channel === "email") {
      for (const owner of owners) {
        if (!owner.ownerEmail) continue;
        const email = formatOwnerEmail(owner, ctx);
        await sendMail({
          to: owner.ownerEmail,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
        sent += 1;
      }
    } else if (channel === "slack" && slackWebhookUrl) {
      await postJson(slackWebhookUrl, buildSlackMessage(owners, ctx));
      sent = owners.length;
    } else if (channel === "webhook" && reminderWebhookUrl) {
      await postJson(reminderWebhookUrl, buildWebhookPayload(owners, ctx));
      sent = owners.length;
    }

    return NextResponse.json({
      channel,
      sent,
      ownerCount: owners.length,
      ...(channel === "clipboard"
        ? { payload: formatReminderDigest(owners, ctx) }
        : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send reminders" },
      { status: 500 }
    );
  }
}

async function postJson(url: string, payload: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Reminder delivery failed (${res.status})`);
  }
}
