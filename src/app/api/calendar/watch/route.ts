import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/google-calendar";
import {
  calendarWebhookUrl,
  createOrRenewCalendarWatchChannel,
} from "@/lib/google-calendar-watch";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single<{ current_organization_id: string | null }>();

  if (profileError || !profile?.current_organization_id) {
    return NextResponse.json({ error: "Workspace required" }, { status: 409 });
  }

  const parsedBody = await request.json().catch(() => ({}));
  const body =
    parsedBody && typeof parsedBody === "object"
      ? (parsedBody as { calendarId?: unknown; ttlSeconds?: unknown })
      : {};
  const calendarId = typeof body.calendarId === "string" ? body.calendarId : "primary";
  const ttlSeconds =
    typeof body.ttlSeconds === "number" && Number.isFinite(body.ttlSeconds)
      ? Math.max(3600, Math.min(body.ttlSeconds, 604800))
      : 604800;

  try {
    const accessToken = await getValidAccessToken(user.id);
    const channel = await createOrRenewCalendarWatchChannel({
      userId: user.id,
      organizationId: profile.current_organization_id,
      calendarId,
      accessToken,
      webhookUrl: calendarWebhookUrl(request.url),
      ttlSeconds,
    });

    return NextResponse.json(channel);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar watch renewal failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
