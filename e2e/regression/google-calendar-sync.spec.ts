import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  getGoogleMeetingUrl,
  normalizeGoogleCalendarEvent,
  shouldImportGoogleCalendarEvent,
} from "../../src/lib/google-calendar-sync";
import {
  GoogleCalendarSyncExpiredError,
  listAgendaEventChanges,
} from "../../src/lib/google-calendar";

test.describe("Google Calendar event normalization", () => {
  test("recurring instances map to one series and distinct meetings", () => {
    const first = normalizeGoogleCalendarEvent({
      calendarId: "primary",
      selfEmail: "pratik@example.com",
      event: {
        id: "recurring-1_20260601T170000Z",
        iCalUID: "recurring-1@example.com",
        recurringEventId: "recurring-1",
        summary: "Product operating review",
        status: "confirmed",
        eventType: "default",
        start: { dateTime: "2026-06-01T10:00:00-07:00" },
        end: { dateTime: "2026-06-01T10:30:00-07:00" },
        originalStartTime: { dateTime: "2026-06-01T10:00:00-07:00" },
        attendees: [
          { email: "pratik@example.com", self: true, responseStatus: "accepted" },
          { email: "lead@example.com", responseStatus: "needsAction" },
        ],
        conferenceData: {
          entryPoints: [
            { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
          ],
        },
      },
    });

    const second = normalizeGoogleCalendarEvent({
      calendarId: "primary",
      selfEmail: "pratik@example.com",
      event: {
        id: "recurring-1_20260608T170000Z",
        iCalUID: "recurring-1@example.com",
        recurringEventId: "recurring-1",
        summary: "Product operating review",
        status: "confirmed",
        eventType: "default",
        start: { dateTime: "2026-06-08T10:00:00-07:00" },
        end: { dateTime: "2026-06-08T10:30:00-07:00" },
        originalStartTime: { dateTime: "2026-06-08T10:00:00-07:00" },
      },
    });

    expect(first.seriesKind).toBe("recurring");
    expect(first.cadence).toBe("weekly");
    expect(first.seriesKey).toBe(second.seriesKey);
    expect(first.meetingKey).not.toBe(second.meetingKey);
    expect(first.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(first.attendeeEmails).toEqual(["pratik@example.com", "lead@example.com"]);
  });

  test("single events map to ad hoc series", () => {
    const normalized = normalizeGoogleCalendarEvent({
      calendarId: "primary",
      event: {
        id: "single-1",
        iCalUID: "single-1@example.com",
        summary: "Vendor escalation",
        status: "confirmed",
        eventType: "default",
        start: { dateTime: "2026-06-01T15:00:00Z" },
        end: { dateTime: "2026-06-01T15:45:00Z" },
        hangoutLink: "https://meet.google.com/vendor-room",
      },
    });

    expect(normalized.seriesKind).toBe("adhoc");
    expect(normalized.cadence).toBe("adhoc");
    expect(normalized.seriesKey).toBe("gcal:primary:event:single-1");
    expect(normalized.meetingKey).toBe("gcal:primary:event:single-1");
    expect(normalized.meetingUrl).toBe("https://meet.google.com/vendor-room");
  });

  test("filters out noisy or unavailable events", () => {
    const base = {
      id: "event-1",
      summary: "Focus",
      status: "confirmed",
      eventType: "default",
      start: { dateTime: "2026-06-01T15:00:00Z" },
      end: { dateTime: "2026-06-01T15:30:00Z" },
    };

    expect(shouldImportGoogleCalendarEvent({ ...base })).toBe(true);
    expect(shouldImportGoogleCalendarEvent({ ...base, status: "cancelled" })).toBe(false);
    expect(
      shouldImportGoogleCalendarEvent({
        ...base,
        start: { date: "2026-06-01" },
        end: { date: "2026-06-02" },
      })
    ).toBe(false);
    expect(shouldImportGoogleCalendarEvent({ ...base, eventType: "focusTime" })).toBe(false);
    expect(shouldImportGoogleCalendarEvent({ ...base, eventType: "outOfOffice" })).toBe(false);
    expect(
      shouldImportGoogleCalendarEvent({
        ...base,
        attendees: [{ email: "pratik@example.com", self: true, responseStatus: "declined" }],
      })
    ).toBe(false);
  });

  test("Google Meet URL prefers video conference entry points", () => {
    const url = getGoogleMeetingUrl({
      hangoutLink: "https://meet.google.com/fallback",
      conferenceData: {
        entryPoints: [
          { entryPointType: "phone", uri: "tel:+1" },
          { entryPointType: "video", uri: "https://meet.google.com/preferred" },
        ],
      },
    });

    expect(url).toBe("https://meet.google.com/preferred");
  });

  test("incremental agenda changes use updatedMin without syncToken or window filters", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl: URL | null = null;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = new URL(String(input));
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await listAgendaEventChanges({
        accessToken: "test-token",
        calendarId: "primary",
        updatedMin: new Date("2026-06-01T00:00:00Z"),
        maxResults: 25,
      });

      expect(requestedUrl).not.toBeNull();
      expect(requestedUrl?.searchParams.get("updatedMin")).toBe("2026-06-01T00:00:00.000Z");
      expect(requestedUrl?.searchParams.get("showDeleted")).toBe("true");
      expect(requestedUrl?.searchParams.get("singleEvents")).toBe("true");
      expect(requestedUrl?.searchParams.get("syncToken")).toBeNull();
      expect(requestedUrl?.searchParams.get("timeMin")).toBeNull();
      expect(requestedUrl?.searchParams.get("timeMax")).toBeNull();
      expect(requestedUrl?.searchParams.get("orderBy")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("incremental agenda changes surface expired sync state", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => new Response("expired", { status: 410 })) as typeof fetch;

    try {
      await expect(
        listAgendaEventChanges({
          accessToken: "test-token",
          calendarId: "primary",
          updatedMin: new Date("2026-06-01T00:00:00Z"),
        })
      ).rejects.toBeInstanceOf(GoogleCalendarSyncExpiredError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stored agenda event upsert is workspace scoped", async () => {
    const helper = await readFile(
      path.join(process.cwd(), "src/lib/google-calendar-agenda-sync.ts"),
      "utf8"
    );
    const migration = await readFile(
      path.join(process.cwd(), "supabase/migrations/20260603012000_google_calendar_sync_state.sql"),
      "utf8"
    );

    expect(helper).toContain('onConflict: "user_id,organization_id,calendar_id,event_id"');
    expect(migration).toContain(
      "idx_google_calendar_events_org_user_calendar_event"
    );
  });
});
