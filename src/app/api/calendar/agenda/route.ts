import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getValidAccessToken,
  GoogleCalendarSyncExpiredError,
  listAgendaEventChanges,
  listAgendaEvents,
} from "@/lib/google-calendar";
import {
  normalizeImportableGoogleCalendarEvents,
  shouldImportGoogleCalendarEvent,
} from "@/lib/google-calendar-sync";
import {
  deleteCalendarAgendaEventsByProviderId,
  deleteStoredCalendarAgendaWindow,
  getCalendarAgendaSyncState,
  listStoredCalendarAgenda,
  recordCalendarAgendaSyncFailure,
  recordCalendarAgendaSyncSuccess,
  syncCalendarAgenda,
} from "@/lib/google-calendar-agenda-sync";
import type { GoogleCalendarRawEvent } from "@/lib/google-calendar-sync";

const AGENDA_WINDOW_DAYS = 14;
const AGENDA_CALENDAR_ID = "primary";

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
    const timeMax = new Date(now.getTime() + AGENDA_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const syncStartedAt = new Date().toISOString();
    const syncState = await getCalendarAgendaSyncState({
      userId: user.id,
      organizationId: profile.current_organization_id,
      calendarId: AGENDA_CALENDAR_ID,
    });
    let syncType: "full" | "incremental" = "full";
    let rawEvents: GoogleCalendarRawEvent[];

    try {
      if (syncState?.last_success_at) {
        syncType = "incremental";
        rawEvents = await listAgendaEventChanges({
          accessToken,
          calendarId: AGENDA_CALENDAR_ID,
          updatedMin: new Date(syncState.last_success_at),
        });
      } else {
        rawEvents = await listAgendaEvents({
          accessToken,
          calendarId: AGENDA_CALENDAR_ID,
          timeMin: now,
          timeMax,
        });
      }
    } catch (err) {
      if (!(err instanceof GoogleCalendarSyncExpiredError)) throw err;
      syncType = "full";
      rawEvents = await listAgendaEvents({
        accessToken,
        calendarId: AGENDA_CALENDAR_ID,
        timeMin: now,
        timeMax,
      });
    }

    if (syncType === "full") {
      await deleteStoredCalendarAgendaWindow({
        userId: user.id,
        organizationId: profile.current_organization_id,
        calendarId: AGENDA_CALENDAR_ID,
        timeMin: now,
        timeMax,
      });
    }

    await deleteCalendarAgendaEventsByProviderId({
      userId: user.id,
      organizationId: profile.current_organization_id,
      calendarId: AGENDA_CALENDAR_ID,
      eventIds: rawEvents
        .filter((event) => !shouldImportGoogleCalendarEvent(event))
        .map((event) => event.id),
    });

    const events = normalizeImportableGoogleCalendarEvents({
      calendarId: AGENDA_CALENDAR_ID,
      selfEmail: user.email,
      events: rawEvents,
    });
    await syncCalendarAgenda({
      userId: user.id,
      organizationId: profile.current_organization_id,
      events,
    });
    await recordCalendarAgendaSyncSuccess({
      userId: user.id,
      organizationId: profile.current_organization_id,
      calendarId: AGENDA_CALENDAR_ID,
      syncStartedAt,
      syncType,
    });
    const agenda = await listStoredCalendarAgenda({
      userId: user.id,
      organizationId: profile.current_organization_id,
      timeMin: now,
      timeMax,
    });

    return NextResponse.json({
      connected: true,
      syncedAt: syncStartedAt,
      syncMode: syncType,
      events: agenda,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar agenda failed";
    if (message.includes("not connected")) {
      return NextResponse.json({ connected: false, events: [] });
    }
    if (profile.current_organization_id) {
      await recordCalendarAgendaSyncFailure({
        userId: user.id,
        organizationId: profile.current_organization_id,
        calendarId: AGENDA_CALENDAR_ID,
        syncStartedAt: new Date().toISOString(),
        errorMessage: message,
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
