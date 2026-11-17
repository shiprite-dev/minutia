import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";
import { startCalendarAgendaEvent, syncCalendarAgenda } from "../../src/lib/google-calendar-agenda-sync";
import { syncCalendarAgendaForUser } from "../../src/lib/google-calendar-agenda-service";
import { storeTokens } from "../../src/lib/google-calendar";
import type { NormalizedGoogleCalendarEvent } from "../../src/lib/google-calendar-sync";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

function serviceHeaders(prefer = "return=minimal") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function rest(
  request: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...serviceHeaders(),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

async function prepareAppForSeedUser(request: APIRequestContext) {
  await rest(request, "instance_config?key=eq.setup_completed", {
    method: "PATCH",
    data: { value: "true" },
  });
  await rest(request, `profiles?id=eq.${TEST_USER_ID}`, {
    method: "PATCH",
    data: { has_completed_onboarding: true },
    headers: serviceHeaders("return=representation"),
  });
}

async function getSeedWorkspaceId(request: APIRequestContext) {
  const rows = await rest(
    request,
    `profiles?id=eq.${TEST_USER_ID}&select=current_organization_id`
  );
  expect(rows[0]?.current_organization_id).toBeTruthy();
  return rows[0].current_organization_id as string;
}

async function createLinkedCalendarMeeting(
  request: APIRequestContext,
  orgId: string
) {
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      organization_id: orgId,
      owner_id: TEST_USER_ID,
      name: "Live synced calendar series",
      description: "Calendar live state regression",
      cadence: "weekly",
      default_attendees: ["pratik@example.com"],
    },
  });

  await rest(request, "meetings", {
    method: "POST",
    data: {
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: "Live synced calendar meeting",
      date: today,
      attendees: ["pratik@example.com"],
      status: "live",
      notes_markdown: "",
    },
  });

  return { seriesId, meetingId };
}

function agendaEvent(overrides: Partial<NormalizedGoogleCalendarEvent> = {}): NormalizedGoogleCalendarEvent {
  const eventId = randomUUID();
  return {
    calendarId: "primary",
    providerEventId: `event-${eventId}`,
    iCalUID: `event-${eventId}@example.com`,
    recurringEventId: null,
    originalStartTime: null,
    seriesKey: `gcal:primary:event:${eventId}`,
    meetingKey: `gcal:primary:event:${eventId}`,
    seriesKind: "adhoc",
    cadence: "adhoc",
    title: "Calendar described meeting",
    description: "Calendar description syncs into the Minutia meeting.",
    startAt: "2026-06-10T15:00:00Z",
    endAt: "2026-06-10T15:30:00Z",
    htmlLink: "https://calendar.google.com/event?eid=description-sync",
    meetingUrl: "https://meet.google.com/description-sync",
    attendeeEmails: ["pratik@example.com"],
    organizerEmail: "pratik@example.com",
    eventType: "default",
    status: "confirmed",
    ...overrides,
  };
}

test.describe("Google Calendar agenda", () => {
  test("syncs calendar description into new meeting notes without overwriting captured notes", async ({
    request,
  }) => {
    await prepareAppForSeedUser(request);
    const orgId = await getSeedWorkspaceId(request);
    const event = agendaEvent();
    let meetingId: string | null = null;

    try {
      const [synced] = await syncCalendarAgenda({
        userId: TEST_USER_ID,
        organizationId: orgId,
        events: [event],
      });
      meetingId = synced.meetingId;

      const createdRows = await rest(
        request,
        `meetings?id=eq.${meetingId}&select=notes_markdown,gcal_meeting_url`
      );
      expect(createdRows[0]).toMatchObject({
        notes_markdown: event.description,
        gcal_meeting_url: event.meetingUrl,
      });

      await rest(request, `meetings?id=eq.${meetingId}`, {
        method: "PATCH",
        data: { notes_markdown: "Captured live notes stay intact." },
      });

      await syncCalendarAgenda({
        userId: TEST_USER_ID,
        organizationId: orgId,
        events: [
          {
            ...event,
            description: "Updated calendar description should not overwrite notes.",
          },
        ],
      });

      const updatedRows = await rest(
        request,
        `meetings?id=eq.${meetingId}&select=notes_markdown`
      );
      expect(updatedRows[0]?.notes_markdown).toBe("Captured live notes stay intact.");
    } finally {
      await rest(
        request,
        `meeting_series?organization_id=eq.${orgId}&gcal_series_key=eq.${encodeURIComponent(event.seriesKey)}`,
        { method: "DELETE" }
      ).catch(() => undefined);
    }
  });

  test("opens calendar event details and starts capture from the sidebar", async ({
    page,
    request,
  }) => {
    await prepareAppForSeedUser(request);

    await page.route("**/api/calendar/status", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          directoryConnected: true,
          googleEmail: "pratik@example.com",
        }),
      });
    });

    await page.route("**/api/calendar/agenda", async (route) => {
      const now = new Date();
      const start = new Date(now);
      start.setHours(10, 0, 0, 0);
      const end = new Date(now);
      end.setHours(10, 30, 0, 0);

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          syncedAt: now.toISOString(),
          events: [
            {
              id: "calendar-event-1",
              calendarId: "primary",
              eventId: "recurring-1_20260601T170000Z",
              seriesId: "10000000-0000-0000-0000-000000000001",
              meetingId: "20000000-0000-0000-0000-000000000004",
              seriesKind: "recurring",
              title: "Product operating review",
              description: "Review open launch blockers.",
              startAt: start.toISOString(),
              endAt: end.toISOString(),
              htmlLink: "https://calendar.google.com/event?eid=abc",
              meetingUrl: "https://meet.google.com/abc-defg-hij",
              attendeeEmails: ["pratik@example.com", "lead@example.com"],
              organizerEmail: "pratik@example.com",
              eventType: "default",
              eventStatus: "confirmed",
              meetingStatus: "upcoming",
            },
          ],
        }),
      });
    });

    await page.route("**/api/calendar/agenda/start", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          meetingUrl: "https://meet.google.com/abc-defg-hij",
          captureUrl: "/series/10000000-0000-0000-0000-000000000001/meetings/20000000-0000-0000-0000-000000000004",
        }),
      });
    });

    await page.goto("/");
    await waitForApp(page);

    await page.getByRole("button", { name: "Open calendar" }).click();
    const sidebar = page.getByRole("complementary", {
      name: "Calendar sidebar",
    });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText("Product operating review")).toBeVisible();
    await expect(sidebar.getByText("Recurring")).toBeVisible();

    await sidebar.getByRole("button", { name: /Product operating review/ }).click();
    await expect(sidebar.getByText("Review open launch blockers.")).toBeVisible();
    await expect(sidebar.getByText("Google Meet link available")).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "https://meet.google.com/abc-defg-hij" })
    ).toBeVisible();

    const popupPromise = page.waitForEvent("popup");
    await sidebar.getByRole("button", { name: "Start meeting" }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL("https://meet.google.com/abc-defg-hij");
    await page.waitForURL(/\/series\/10000000-0000-0000-0000-000000000001\/meetings\/20000000-0000-0000-0000-000000000004/);
  });

  test("shows join state when a synced calendar event is already live", async ({
    page,
    request,
  }) => {
    await prepareAppForSeedUser(request);
    const orgId = await getSeedWorkspaceId(request);
    const { seriesId, meetingId } = await createLinkedCalendarMeeting(request, orgId);
    let startRequests = 0;

    try {
      await page.route("**/api/calendar/status", async (route) => {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            connected: true,
            directoryConnected: true,
            googleEmail: "pratik@example.com",
          }),
        });
      });

      await page.route("**/api/calendar/agenda", async (route) => {
        const now = new Date();
        const start = new Date(now);
        start.setHours(19, 0, 0, 0);
        const end = new Date(now);
        end.setHours(21, 0, 0, 0);

        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            connected: true,
            syncedAt: now.toISOString(),
            events: [
              {
                id: "calendar-event-live-1",
                calendarId: "primary",
                eventId: "live-event-1",
                seriesId,
                meetingId,
                seriesKind: "recurring",
                title: "Japanese Class",
                description: "Language practice.",
                startAt: start.toISOString(),
                endAt: end.toISOString(),
                htmlLink: "https://calendar.google.com/event?eid=live",
                meetingUrl: "https://meet.google.com/live-join-now",
                attendeeEmails: [],
                organizerEmail: "pratik@example.com",
                eventType: "default",
                eventStatus: "confirmed",
                meetingStatus: "upcoming",
              },
            ],
          }),
        });
      });

      await page.route("**/api/calendar/agenda/start", async (route) => {
        startRequests += 1;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            meetingUrl: "https://meet.google.com/live-join-now",
            captureUrl: `/series/${seriesId}/meetings/${meetingId}`,
          }),
        });
      });

      await page.goto("/");
      await waitForApp(page);

      await page.getByRole("button", { name: "Open calendar" }).click();
      const sidebar = page.getByRole("complementary", {
        name: "Calendar sidebar",
      });
      await expect(sidebar).toBeVisible();

      await sidebar.getByRole("button", { name: /Japanese Class/ }).click();
      await expect(sidebar.getByText("Meeting in progress")).toBeVisible();
      await expect(sidebar.getByRole("button", { name: "Join now" })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: "Start meeting" })).toHaveCount(0);

      const popupPromise = page.waitForEvent("popup");
      await sidebar.getByRole("button", { name: "Join now" }).click();
      const popup = await popupPromise;
      await expect(popup).toHaveURL("https://meet.google.com/live-join-now");
      await page.waitForURL(new RegExp(`/series/${seriesId}/meetings/${meetingId}`));
      expect(startRequests).toBe(0);
    } finally {
      await rest(request, `meeting_series?id=eq.${seriesId}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
  });
});
test.describe("Google Calendar agenda sync", () => {
  test("one-off meetings stay in the agenda and startable, and a cancelled recurring instance leaves the agenda while its meeting and items stay", async ({
    request,
  }) => {

    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString(
      "base64",
    );
    const orgId = await getSeedWorkspaceId(request);
    const runId = randomUUID().slice(0, 8);
    const createdRes = await request.post(
      `${SUPABASE_URL}/auth/v1/admin/users`,
      {
        headers: serviceHeaders(),
        data: {
          email: `agenda-${runId}@example.com`,
          password: "password123",
          email_confirm: true,
        },
      },
    );
    expect(createdRes.ok()).toBeTruthy();
    const created = await createdRes.json();
    const userId = (created.id ?? created.user?.id) as string;

    const at = (days: number, hour: number) => {
      const date = new Date(Date.now() + days * 86_400_000);
      date.setUTCHours(hour, 0, 0, 0);
      return date.toISOString();
    };
    const oneOff = {
      id: `oneoff-${runId}`,
      summary: `Coffee with Sam ${runId}`,
      status: "confirmed",
      start: { dateTime: at(1, 10) },
      end: { dateTime: at(1, 11) },
    };
    const weeklyInstance = {
      id: `weekly-${runId}_1`,
      recurringEventId: `weekly-${runId}`,
      originalStartTime: { dateTime: at(2, 10) },
      summary: `Weekly sync ${runId}`,
      status: "confirmed",
      start: { dateTime: at(2, 10) },
      end: { dateTime: at(2, 11) },
    };

    const nextWeekInstance = {
      ...weeklyInstance,
      id: `weekly-${runId}_2`,
      originalStartTime: { dateTime: at(9, 10) },
      start: { dateTime: at(9, 10) },
      end: { dateTime: at(9, 11) },
    };

    let googleEvents: unknown[] = [oneOff, weeklyInstance, nextWeekInstance];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("https://www.googleapis.com/calendar/v3/")
        ? new Response(JSON.stringify({ items: googleEvents }), { status: 200 })
        : realFetch(input, init)) as typeof fetch;

    try {
      await storeTokens(userId, "access", "refresh", 3600, "solo@example.com", [
        "https://www.googleapis.com/auth/calendar.readonly",
      ]);

      const first = await syncCalendarAgendaForUser({
        userId,
        organizationId: orgId,
      });
      const titles = first.events.map((event) => event.title);
      expect(titles).toContain(oneOff.summary);
      expect(titles).toContain(weeklyInstance.summary);

      const coffee = first.events.find(
        (event) => event.title === oneOff.summary,
      )!;
      const started = await startCalendarAgendaEvent({
        userId,
        calendarEventId: coffee.id,
      });
      expect(started.captureUrl).toBe(
        `/series/${coffee.seriesId}/meetings/${coffee.meetingId}`,
      );
      const [live] = await rest(
        request,
        `meetings?id=eq.${coffee.meetingId}&select=status`,
      );
      expect(live.status).toBe("live");

      const weekly = first.events.find(
        (event) => event.title === weeklyInstance.summary,
      )!;
      const nextWeek = first.events.find(
        (event) => Date.parse(event.startAt) === Date.parse(nextWeekInstance.start.dateTime)
      )!;
      await rest(request, "issues", {
        method: "POST",
        data: {
          series_id: nextWeek.seriesId,
          raised_in_meeting_id: nextWeek.meetingId,
          title: `Bring the roadmap ${runId}`,
          category: "action",
          status: "open",
        },
      });

      googleEvents = [
        { ...weeklyInstance, status: "cancelled" },
        { ...nextWeekInstance, status: "cancelled" },
      ];
      const second = await syncCalendarAgendaForUser({
        userId,
        organizationId: orgId,
      });

      expect(second.events.map((event) => event.title)).toEqual([
        oneOff.summary,
      ]);
      const kept = await rest(
        request,
        `meetings?id=in.(${weekly.meetingId},${nextWeek.meetingId})&select=id`,
      );
      expect(kept).toHaveLength(2);
      const keptItems = await rest(
        request,
        `issues?raised_in_meeting_id=eq.${nextWeek.meetingId}&select=title`
      );
      expect(keptItems).toEqual([{ title: `Bring the roadmap ${runId}` }]);

      const [{ series_id: weeklySeriesId }] = await rest(
        request,
        `meetings?id=eq.${weekly.meetingId}&select=series_id`,
      );
      await rest(request, "meetings", {
        method: "POST",
        data: {
          series_id: weeklySeriesId,
          sequence_number: 4,
          title: `Ad hoc catch-up ${runId}`,
          date: at(3, 0).slice(0, 10),
          status: "completed",
          notes_markdown: "",
        },
      });
      const thirdInstance = {
        ...weeklyInstance,
        id: `weekly-${runId}_3`,
        originalStartTime: { dateTime: at(11, 10) },
        start: { dateTime: at(11, 10) },
        end: { dateTime: at(11, 11) },
      };
      googleEvents = [thirdInstance];
      const third = await syncCalendarAgendaForUser({
        userId,
        organizationId: orgId,
      });
      expect(
        third.events.some(
          (event) => Date.parse(event.startAt) === Date.parse(thirdInstance.start.dateTime),
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      await rest(request, `meeting_series?owner_id=eq.${userId}`, {
        method: "DELETE",
      }).catch(() => undefined);
      await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        headers: serviceHeaders(),
      });
    }
  });
});
