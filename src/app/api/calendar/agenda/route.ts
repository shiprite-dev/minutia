import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken, listAgendaEvents } from "@/lib/google-calendar";
import { normalizeImportableGoogleCalendarEvents } from "@/lib/google-calendar-sync";
import { syncCalendarAgenda } from "@/lib/google-calendar-agenda-sync";

const AGENDA_WINDOW_DAYS = 14;

export async function GET() {
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

  try {
    const accessToken = await getValidAccessToken(user.id);
    const now = new Date();
    const rawEvents = await listAgendaEvents({
      accessToken,
      timeMin: now,
      timeMax: new Date(now.getTime() + AGENDA_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    });
    const events = normalizeImportableGoogleCalendarEvents({
      calendarId: "primary",
      selfEmail: user.email,
      events: rawEvents,
    });
    const agenda = await syncCalendarAgenda({
      userId: user.id,
      organizationId: profile.current_organization_id,
      events,
    });

    return NextResponse.json({
      connected: true,
      syncedAt: new Date().toISOString(),
      events: agenda,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar agenda failed";
    if (message.includes("not connected")) {
      return NextResponse.json({ connected: false, events: [] });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
