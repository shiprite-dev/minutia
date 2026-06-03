import {
  getValidAccessToken,
  GoogleCalendarSyncExpiredError,
  listAgendaEventChanges,
  listAgendaEvents,
} from "./google-calendar";
import {
  deleteCalendarAgendaEventsByProviderId,
  deleteStoredCalendarAgendaWindow,
  getCalendarAgendaSyncState,
  listStoredCalendarAgenda,
  recordCalendarAgendaSyncFailure,
  recordCalendarAgendaSyncSuccess,
  syncCalendarAgenda,
} from "./google-calendar-agenda-sync";
import {
  normalizeImportableGoogleCalendarEvents,
  shouldImportGoogleCalendarEvent,
  type GoogleCalendarRawEvent,
} from "./google-calendar-sync";
import type { GoogleCalendarAgendaItem } from "./types";

const AGENDA_WINDOW_DAYS = 14;
export const AGENDA_CALENDAR_ID = "primary";

export type CalendarAgendaSyncResult = {
  connected: boolean;
  syncedAt?: string;
  syncMode?: "full" | "incremental";
  events: GoogleCalendarAgendaItem[];
};

export async function syncCalendarAgendaForUser({
  userId,
  organizationId,
  selfEmail,
  calendarId = AGENDA_CALENDAR_ID,
  now = new Date(),
}: {
  userId: string;
  organizationId: string;
  selfEmail?: string;
  calendarId?: string;
  now?: Date;
}): Promise<CalendarAgendaSyncResult> {
  const timeMax = new Date(now.getTime() + AGENDA_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const syncStartedAt = new Date().toISOString();

  try {
    const accessToken = await getValidAccessToken(userId);
    const syncState = await getCalendarAgendaSyncState({
      userId,
      organizationId,
      calendarId,
    });
    let syncType: "full" | "incremental" = "full";
    let rawEvents: GoogleCalendarRawEvent[];

    try {
      if (syncState?.last_success_at) {
        syncType = "incremental";
        rawEvents = await listAgendaEventChanges({
          accessToken,
          calendarId,
          updatedMin: new Date(syncState.last_success_at),
        });
      } else {
        rawEvents = await listAgendaEvents({
          accessToken,
          calendarId,
          timeMin: now,
          timeMax,
        });
      }
    } catch (err) {
      if (!(err instanceof GoogleCalendarSyncExpiredError)) throw err;
      syncType = "full";
      rawEvents = await listAgendaEvents({
        accessToken,
        calendarId,
        timeMin: now,
        timeMax,
      });
    }

    if (syncType === "full") {
      await deleteStoredCalendarAgendaWindow({
        userId,
        organizationId,
        calendarId,
        timeMin: now,
        timeMax,
      });
    }

    await deleteCalendarAgendaEventsByProviderId({
      userId,
      organizationId,
      calendarId,
      eventIds: rawEvents
        .filter((event) => !shouldImportGoogleCalendarEvent(event))
        .map((event) => event.id),
    });

    const events = normalizeImportableGoogleCalendarEvents({
      calendarId,
      selfEmail,
      events: rawEvents,
    });
    await syncCalendarAgenda({ userId, organizationId, events });
    await recordCalendarAgendaSyncSuccess({
      userId,
      organizationId,
      calendarId,
      syncStartedAt,
      syncType,
    });

    return {
      connected: true,
      syncedAt: syncStartedAt,
      syncMode: syncType,
      events: await listStoredCalendarAgenda({
        userId,
        organizationId,
        timeMin: now,
        timeMax,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar agenda failed";
    if (message.includes("not connected")) {
      return { connected: false, events: [] };
    }
    await recordCalendarAgendaSyncFailure({
      userId,
      organizationId,
      calendarId,
      syncStartedAt,
      errorMessage: message,
    }).catch(() => undefined);
    throw err;
  }
}
