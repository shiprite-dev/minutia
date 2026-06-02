import type { Cadence } from "./types";

type GoogleCalendarDate = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleCalendarAttendee = {
  email?: string;
  self?: boolean;
  responseStatus?: string;
};

type GoogleCalendarEntryPoint = {
  entryPointType?: string;
  uri?: string;
};

export type GoogleCalendarRawEvent = {
  id: string;
  iCalUID?: string;
  recurringEventId?: string;
  summary?: string;
  description?: string;
  status?: string;
  eventType?: string;
  start?: GoogleCalendarDate;
  end?: GoogleCalendarDate;
  originalStartTime?: GoogleCalendarDate;
  attendees?: GoogleCalendarAttendee[];
  organizer?: { email?: string };
  creator?: { email?: string };
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: GoogleCalendarEntryPoint[];
  };
};

export type NormalizedGoogleCalendarEvent = {
  calendarId: string;
  providerEventId: string;
  iCalUID: string | null;
  recurringEventId: string | null;
  originalStartTime: string | null;
  seriesKey: string;
  meetingKey: string;
  seriesKind: "recurring" | "adhoc";
  cadence: Cadence;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  htmlLink: string | null;
  meetingUrl: string | null;
  attendeeEmails: string[];
  organizerEmail: string | null;
  eventType: string;
  status: string;
};

export function shouldImportGoogleCalendarEvent(event: GoogleCalendarRawEvent) {
  if (event.status === "cancelled") return false;
  if (!event.start?.dateTime || !event.end?.dateTime) return false;
  if (["focusTime", "outOfOffice", "workingLocation", "birthday"].includes(event.eventType ?? "")) {
    return false;
  }

  const selfAttendee = event.attendees?.find((attendee) => attendee.self);
  if (selfAttendee?.responseStatus === "declined") return false;

  return true;
}

export function getGoogleMeetingUrl(event: Pick<GoogleCalendarRawEvent, "conferenceData" | "hangoutLink">) {
  const videoEntry = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && entry.uri
  );
  return videoEntry?.uri ?? event.hangoutLink ?? null;
}

export function normalizeGoogleCalendarEvent({
  calendarId,
  event,
}: {
  calendarId: string;
  selfEmail?: string;
  event: GoogleCalendarRawEvent;
}): NormalizedGoogleCalendarEvent {
  if (!event.start?.dateTime || !event.end?.dateTime) {
    throw new Error("Timed Google Calendar event required");
  }

  const recurringIdentity = event.recurringEventId ?? null;
  const originalStartTime = event.originalStartTime?.dateTime ?? event.originalStartTime?.date ?? null;
  const seriesKind = recurringIdentity ? "recurring" : "adhoc";
  const recurringKey = recurringIdentity ?? event.iCalUID ?? event.id;
  const seriesKey = recurringIdentity
    ? `gcal:${calendarId}:recurring:${recurringKey}`
    : `gcal:${calendarId}:event:${event.id}`;
  const meetingKey = recurringIdentity
    ? `gcal:${calendarId}:recurring:${recurringKey}:instance:${originalStartTime ?? event.id}`
    : seriesKey;

  return {
    calendarId,
    providerEventId: event.id,
    iCalUID: event.iCalUID ?? null,
    recurringEventId: recurringIdentity,
    originalStartTime,
    seriesKey,
    meetingKey,
    seriesKind,
    cadence: recurringIdentity ? "weekly" : "adhoc",
    title: event.summary?.trim() || "(No title)",
    description: event.description?.trim() || null,
    startAt: event.start.dateTime,
    endAt: event.end.dateTime,
    htmlLink: event.htmlLink ?? null,
    meetingUrl: getGoogleMeetingUrl(event),
    attendeeEmails: (event.attendees ?? [])
      .map((attendee) => attendee.email?.trim())
      .filter((email): email is string => !!email),
    organizerEmail: event.organizer?.email ?? event.creator?.email ?? null,
    eventType: event.eventType ?? "default",
    status: event.status ?? "confirmed",
  };
}

export function normalizeImportableGoogleCalendarEvents({
  calendarId,
  selfEmail,
  events,
}: {
  calendarId: string;
  selfEmail?: string;
  events: GoogleCalendarRawEvent[];
}) {
  return events
    .filter(shouldImportGoogleCalendarEvent)
    .map((event) => normalizeGoogleCalendarEvent({ calendarId, selfEmail, event }));
}
