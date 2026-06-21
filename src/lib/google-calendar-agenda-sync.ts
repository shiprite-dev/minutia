import type { NormalizedGoogleCalendarEvent } from "./google-calendar-sync";
import { createServiceRoleClient } from "./supabase/service-role";
import { parseAgendaDrafts } from "./calendar/agenda-draft";
import type { GoogleCalendarAgendaItem, MeetingStatus } from "./types";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

type SeriesRow = {
  id: string;
  name: string;
};

type MeetingRow = {
  id: string;
  status: MeetingStatus;
  notes_markdown: string | null;
};

type CalendarEventRow = {
  id: string;
};

type CalendarSyncStateRow = {
  id: string;
  last_success_at: string | null;
};

type StoredCalendarAgendaRow = {
  id: string;
  calendar_id: string;
  event_id: string;
  series_id: string;
  meeting_id: string;
  series_kind: "recurring" | "adhoc";
  summary: string;
  description: string | null;
  start_at: string;
  end_at: string;
  html_link: string | null;
  meeting_url: string | null;
  attendee_emails: string[];
  organizer_email: string | null;
  event_type: string;
  event_status: string;
  meeting: { status: MeetingStatus } | { status: MeetingStatus }[] | null;
};

const AGENDA_SYNC_MODE = "agenda_window";

function dateOnly(isoDateTime: string) {
  return new Date(isoDateTime).toISOString().slice(0, 10);
}

export async function getCalendarAgendaSyncState({
  userId,
  organizationId,
  calendarId,
}: {
  userId: string;
  organizationId: string;
  calendarId: string;
}): Promise<CalendarSyncStateRow | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("google_calendar_sync_state")
    .select("id, last_success_at")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("calendar_id", calendarId)
    .eq("sync_mode", AGENDA_SYNC_MODE)
    .maybeSingle<CalendarSyncStateRow>();

  if (error) throw error;
  return data;
}

export async function recordCalendarAgendaSyncSuccess({
  userId,
  organizationId,
  calendarId,
  syncStartedAt,
  syncType,
}: {
  userId: string;
  organizationId: string;
  calendarId: string;
  syncStartedAt: string;
  syncType: "full" | "incremental";
}) {
  const supabase = createServiceRoleClient();
  const payload = {
    user_id: userId,
    organization_id: organizationId,
    calendar_id: calendarId,
    sync_mode: AGENDA_SYNC_MODE,
    status: "synced",
    last_success_at: syncStartedAt,
    last_sync_started_at: syncStartedAt,
    error_message: null,
    ...(syncType === "full" ? { last_full_synced_at: syncStartedAt } : {}),
    ...(syncType === "incremental" ? { last_incremental_synced_at: syncStartedAt } : {}),
  };

  const { error } = await supabase
    .from("google_calendar_sync_state")
    .upsert(payload, {
      onConflict: "user_id,organization_id,calendar_id,sync_mode",
    });

  if (error) throw error;
}

export async function recordCalendarAgendaSyncFailure({
  userId,
  organizationId,
  calendarId,
  syncStartedAt,
  errorMessage,
}: {
  userId: string;
  organizationId: string;
  calendarId: string;
  syncStartedAt: string;
  errorMessage: string;
}) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("google_calendar_sync_state")
    .upsert(
      {
        user_id: userId,
        organization_id: organizationId,
        calendar_id: calendarId,
        sync_mode: AGENDA_SYNC_MODE,
        status: "failed",
        last_sync_started_at: syncStartedAt,
        error_message: errorMessage,
      },
      {
        onConflict: "user_id,organization_id,calendar_id,sync_mode",
      }
    );

  if (error) throw error;
}

async function ensureSeries({
  supabase,
  userId,
  organizationId,
  event,
}: {
  supabase: ServiceClient;
  userId: string;
  organizationId: string;
  event: NormalizedGoogleCalendarEvent;
}): Promise<SeriesRow> {
  const { data: existing, error: existingError } = await supabase
    .from("meeting_series")
    .select("id, name")
    .eq("owner_id", userId)
    .eq("organization_id", organizationId)
    .eq("gcal_series_key", event.seriesKey)
    .maybeSingle<SeriesRow>();

  if (existingError) throw existingError;

  const payload = {
    name: event.title,
    description: event.description ?? "",
    cadence: event.cadence,
    default_attendees: event.attendeeEmails,
    gcal_calendar_id: event.calendarId,
    gcal_sync_enabled: true,
    gcal_series_key: event.seriesKey,
    gcal_series_kind: event.seriesKind,
    gcal_last_synced_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await supabase
      .from("meeting_series")
      .update(payload)
      .eq("id", existing.id)
      .select("id, name")
      .single<SeriesRow>();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("meeting_series")
    .insert({
      ...payload,
      owner_id: userId,
      organization_id: organizationId,
    })
    .select("id, name")
    .single<SeriesRow>();

  if (error) throw error;
  return data;
}

// Auto-drafts agenda items parsed from the calendar event description. Only runs
// once, when the meeting is first created, so re-syncing never duplicates drafts.
async function draftAgendaIssues({
  supabase,
  seriesId,
  meetingId,
  description,
}: {
  supabase: ServiceClient;
  seriesId: string;
  meetingId: string;
  description: string | null;
}) {
  const drafts = parseAgendaDrafts(description);
  if (drafts.length === 0) return;

  const { error } = await supabase.from("issues").insert(
    drafts.map((draft) => ({
      series_id: seriesId,
      raised_in_meeting_id: meetingId,
      title: draft.title,
      category: draft.category,
      status: "open",
      source: "calendar_auto_draft",
    }))
  );

  if (error) throw error;
}

async function ensureMeeting({
  supabase,
  seriesId,
  event,
}: {
  supabase: ServiceClient;
  seriesId: string;
  event: NormalizedGoogleCalendarEvent;
}): Promise<MeetingRow> {
  const { data: existing, error: existingError } = await supabase
    .from("meetings")
    .select("id, status, notes_markdown")
    .eq("series_id", seriesId)
    .eq("gcal_meeting_key", event.meetingKey)
    .maybeSingle<MeetingRow>();

  if (existingError) throw existingError;

  const payload = {
    title: event.title,
    date: dateOnly(event.startAt),
    attendees: event.attendeeEmails,
    gcal_meeting_key: event.meetingKey,
    gcal_calendar_id: event.calendarId,
    gcal_event_id: event.providerEventId,
    gcal_original_start_time: event.originalStartTime,
    gcal_meeting_url: event.meetingUrl,
    gcal_html_link: event.htmlLink,
    gcal_last_synced_at: new Date().toISOString(),
  };

  if (existing) {
    const updatePayload = event.description && !existing.notes_markdown?.trim()
      ? { ...payload, notes_markdown: event.description }
      : payload;

    const { data, error } = await supabase
      .from("meetings")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("id, status, notes_markdown")
      .single<MeetingRow>();

    if (error) throw error;
    return data;
  }

  const { count, error: countError } = await supabase
    .from("meetings")
    .select("id", { count: "exact", head: true })
    .eq("series_id", seriesId);

  if (countError) throw countError;

  const { data, error } = await supabase
    .from("meetings")
    .insert({
      ...payload,
      series_id: seriesId,
      sequence_number: (count ?? 0) + 1,
      status: "upcoming",
      notes_markdown: event.description ?? "",
    })
    .select("id, status, notes_markdown")
    .single<MeetingRow>();

  if (error) throw error;

  // Auto-drafting is enrichment, not the critical path. Drafts only once on first
  // creation (so reviewed/deleted drafts are never resurrected on re-sync); a
  // failure here is logged and isolated so it never aborts the calendar sync.
  try {
    await draftAgendaIssues({
      supabase,
      seriesId,
      meetingId: data.id,
      description: event.description,
    });
  } catch (draftError) {
    console.error("Failed to auto-draft agenda issues for meeting", data.id, draftError);
  }

  return data;
}

async function upsertCalendarEvent({
  supabase,
  userId,
  organizationId,
  seriesId,
  meetingId,
  event,
}: {
  supabase: ServiceClient;
  userId: string;
  organizationId: string;
  seriesId: string;
  meetingId: string;
  event: NormalizedGoogleCalendarEvent;
}) {
  const { data, error } = await supabase
    .from("google_calendar_events")
    .upsert(
      {
        user_id: userId,
        organization_id: organizationId,
        series_id: seriesId,
        meeting_id: meetingId,
        calendar_id: event.calendarId,
        event_id: event.providerEventId,
        i_cal_uid: event.iCalUID,
        recurring_event_id: event.recurringEventId,
        original_start_time: event.originalStartTime,
        series_key: event.seriesKey,
        meeting_key: event.meetingKey,
        series_kind: event.seriesKind,
        summary: event.title,
        description: event.description,
        start_at: event.startAt,
        end_at: event.endAt,
        html_link: event.htmlLink,
        meeting_url: event.meetingUrl,
        attendee_emails: event.attendeeEmails,
        organizer_email: event.organizerEmail,
        event_type: event.eventType,
        event_status: event.status,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,organization_id,calendar_id,event_id" }
    )
    .select("id")
    .single<CalendarEventRow>();

  if (error) throw error;
  return data;
}

export async function syncCalendarAgenda({
  userId,
  organizationId,
  events,
}: {
  userId: string;
  organizationId: string;
  events: NormalizedGoogleCalendarEvent[];
}): Promise<GoogleCalendarAgendaItem[]> {
  const supabase = createServiceRoleClient();
  const agenda: GoogleCalendarAgendaItem[] = [];

  for (const event of events) {
    const series = await ensureSeries({ supabase, userId, organizationId, event });
    const meeting = await ensureMeeting({ supabase, seriesId: series.id, event });
    const calendarEvent = await upsertCalendarEvent({
      supabase,
      userId,
      organizationId,
      seriesId: series.id,
      meetingId: meeting.id,
      event,
    });

    agenda.push({
      id: calendarEvent.id,
      calendarId: event.calendarId,
      eventId: event.providerEventId,
      seriesId: series.id,
      meetingId: meeting.id,
      seriesKind: event.seriesKind,
      title: event.title,
      description: event.description,
      startAt: event.startAt,
      endAt: event.endAt,
      htmlLink: event.htmlLink,
      meetingUrl: event.meetingUrl,
      attendeeEmails: event.attendeeEmails,
      organizerEmail: event.organizerEmail,
      eventType: event.eventType,
      eventStatus: event.status,
      meetingStatus: meeting.status,
    });
  }

  return agenda.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

export async function deleteCalendarAgendaEventsByProviderId({
  userId,
  organizationId,
  calendarId,
  eventIds,
}: {
  userId: string;
  organizationId: string;
  calendarId: string;
  eventIds: string[];
}) {
  const uniqueEventIds = Array.from(new Set(eventIds)).filter(Boolean);
  if (uniqueEventIds.length === 0) return;

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("google_calendar_events")
    .delete()
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("calendar_id", calendarId)
    .in("event_id", uniqueEventIds);

  if (error) throw error;
}

export async function deleteStoredCalendarAgendaWindow({
  userId,
  organizationId,
  calendarId,
  timeMin,
  timeMax,
}: {
  userId: string;
  organizationId: string;
  calendarId: string;
  timeMin: Date;
  timeMax: Date;
}) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("google_calendar_events")
    .delete()
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("calendar_id", calendarId)
    .gte("start_at", timeMin.toISOString())
    .lt("start_at", timeMax.toISOString());

  if (error) throw error;
}

export async function listStoredCalendarAgenda({
  userId,
  organizationId,
  timeMin,
  timeMax,
}: {
  userId: string;
  organizationId: string;
  timeMin: Date;
  timeMax: Date;
}): Promise<GoogleCalendarAgendaItem[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("google_calendar_events")
    .select(`
      id,
      calendar_id,
      event_id,
      series_id,
      meeting_id,
      series_kind,
      summary,
      description,
      start_at,
      end_at,
      html_link,
      meeting_url,
      attendee_emails,
      organizer_email,
      event_type,
      event_status,
      meeting:meetings!inner(status)
    `)
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .gte("start_at", timeMin.toISOString())
    .lt("start_at", timeMax.toISOString())
    .order("start_at", { ascending: true })
    .returns<StoredCalendarAgendaRow[]>();

  if (error) throw error;

  return (data ?? []).map((row) => {
    const meeting = Array.isArray(row.meeting) ? row.meeting[0] : row.meeting;

    return {
      id: row.id,
      calendarId: row.calendar_id,
      eventId: row.event_id,
      seriesId: row.series_id,
      meetingId: row.meeting_id,
      seriesKind: row.series_kind,
      title: row.summary,
      description: row.description,
      startAt: row.start_at,
      endAt: row.end_at,
      htmlLink: row.html_link,
      meetingUrl: row.meeting_url,
      attendeeEmails: row.attendee_emails,
      organizerEmail: row.organizer_email,
      eventType: row.event_type,
      eventStatus: row.event_status,
      meetingStatus: meeting?.status ?? "upcoming",
    };
  });
}

export async function startCalendarAgendaEvent({
  userId,
  calendarEventId,
}: {
  userId: string;
  calendarEventId: string;
}) {
  const supabase = createServiceRoleClient();
  const { data: event, error: eventError } = await supabase
    .from("google_calendar_events")
    .select("id, series_id, meeting_id, meeting_url")
    .eq("id", calendarEventId)
    .eq("user_id", userId)
    .single<{ id: string; series_id: string; meeting_id: string; meeting_url: string | null }>();

  if (eventError) throw eventError;

  const { error: updateError } = await supabase
    .from("meetings")
    .update({ status: "live" })
    .eq("id", event.meeting_id);

  if (updateError) throw updateError;

  return {
    meetingUrl: event.meeting_url,
    captureUrl: `/series/${event.series_id}/meetings/${event.meeting_id}`,
  };
}
