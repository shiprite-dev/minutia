import type { NormalizedGoogleCalendarEvent } from "./google-calendar-sync";
import { createServiceRoleClient } from "./supabase/service-role";
import type { GoogleCalendarAgendaItem, MeetingStatus } from "./types";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

type SeriesRow = {
  id: string;
  name: string;
};

type MeetingRow = {
  id: string;
  status: MeetingStatus;
};

type CalendarEventRow = {
  id: string;
};

function dateOnly(isoDateTime: string) {
  return new Date(isoDateTime).toISOString().slice(0, 10);
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
    .select("id, status")
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
    const { data, error } = await supabase
      .from("meetings")
      .update(payload)
      .eq("id", existing.id)
      .select("id, status")
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
    })
    .select("id, status")
    .single<MeetingRow>();

  if (error) throw error;
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
      { onConflict: "user_id,calendar_id,event_id" }
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
