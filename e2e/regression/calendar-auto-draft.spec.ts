import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";
import { syncCalendarAgenda } from "../../src/lib/google-calendar-agenda-sync";
import type { NormalizedGoogleCalendarEvent } from "../../src/lib/google-calendar-sync";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

// A description with one of every detectable shape plus a prose line we must ignore.
const AGENDA_DESCRIPTION = [
  "Sprint planning agenda",
  "",
  "Action: Finalize the launch checklist",
  "- Review onboarding metrics",
  "Decision: Pick the rollout date",
  "Some loose context that should never become an item.",
  "- [ ] Confirm the on-call schedule",
].join("\n");

const EXPECTED_DRAFTS = [
  { title: "Finalize the launch checklist", category: "action" },
  { title: "Review onboarding metrics", category: "info" },
  { title: "Pick the rollout date", category: "decision" },
  { title: "Confirm the on-call schedule", category: "action" },
];

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
    headers: { ...serviceHeaders(), ...(options.headers ?? {}) },
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

function agendaEvent(
  overrides: Partial<NormalizedGoogleCalendarEvent> = {}
): NormalizedGoogleCalendarEvent {
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
    title: "Auto-draft planning meeting",
    description: AGENDA_DESCRIPTION,
    startAt: "2026-06-10T15:00:00Z",
    endAt: "2026-06-10T15:30:00Z",
    htmlLink: "https://calendar.google.com/event?eid=auto-draft",
    meetingUrl: "https://meet.google.com/auto-draft",
    attendeeEmails: ["pratik@example.com"],
    organizerEmail: "pratik@example.com",
    eventType: "default",
    status: "confirmed",
    ...overrides,
  };
}

async function cleanupSeries(
  request: APIRequestContext,
  orgId: string,
  seriesKey: string
) {
  await rest(
    request,
    `meeting_series?organization_id=eq.${orgId}&gcal_series_key=eq.${encodeURIComponent(seriesKey)}`,
    { method: "DELETE" }
  ).catch(() => undefined);
}

test.describe("Calendar auto-draft agenda items", () => {
  test("drafts agenda issues from the event description without duplicating on re-sync", async ({
    request,
  }) => {
    await prepareAppForSeedUser(request);
    const orgId = await getSeedWorkspaceId(request);
    const event = agendaEvent();

    try {
      const [synced] = await syncCalendarAgenda({
        userId: TEST_USER_ID,
        organizationId: orgId,
        events: [event],
      });

      const drafts = await rest(
        request,
        `issues?raised_in_meeting_id=eq.${synced.meetingId}&source=eq.calendar_auto_draft&select=title,category,status,source&order=created_at.asc`
      );

      expect(drafts).toHaveLength(EXPECTED_DRAFTS.length);
      expect(drafts.map((d: { title: string }) => d.title).sort()).toEqual(
        EXPECTED_DRAFTS.map((d) => d.title).sort()
      );
      for (const expected of EXPECTED_DRAFTS) {
        const match = drafts.find((d: { title: string }) => d.title === expected.title);
        expect(match, `missing draft "${expected.title}"`).toBeTruthy();
        expect(match.category).toBe(expected.category);
        expect(match.status).toBe("open");
        expect(match.source).toBe("calendar_auto_draft");
      }

      // The prose line must never be drafted.
      const prose = await rest(
        request,
        `issues?raised_in_meeting_id=eq.${synced.meetingId}&title=eq.${encodeURIComponent("Some loose context that should never become an item.")}&select=id`
      );
      expect(prose).toHaveLength(0);

      // Re-syncing the same event re-uses the existing meeting and must not re-draft.
      await syncCalendarAgenda({
        userId: TEST_USER_ID,
        organizationId: orgId,
        events: [event],
      });
      const afterResync = await rest(
        request,
        `issues?raised_in_meeting_id=eq.${synced.meetingId}&source=eq.calendar_auto_draft&select=id`
      );
      expect(afterResync).toHaveLength(EXPECTED_DRAFTS.length);
    } finally {
      await cleanupSeries(request, orgId, event.seriesKey);
    }
  });

  test("shows drafted items with a Draft badge and a notice on the meeting page", async ({
    page,
    request,
  }) => {
    await prepareAppForSeedUser(request);
    const orgId = await getSeedWorkspaceId(request);
    const event = agendaEvent();

    try {
      const [synced] = await syncCalendarAgenda({
        userId: TEST_USER_ID,
        organizationId: orgId,
        events: [event],
      });

      await page.goto(`/series/${synced.seriesId}/meetings/${synced.meetingId}`);
      await waitForApp(page);
      await expect(
        page.getByRole("heading", { name: "Auto-draft planning meeting", level: 1 })
      ).toBeVisible();

      const drafts = page.getByRole("region", { name: "Drafted agenda items" });
      await expect(drafts).toBeVisible();
      await expect(
        drafts.getByText(/agenda items? drafted from this calendar event/i)
      ).toBeVisible();
      await expect(drafts.getByText("Finalize the launch checklist")).toBeVisible();
      await expect(drafts.getByText("Draft", { exact: true }).first()).toBeVisible();
    } finally {
      await cleanupSeries(request, orgId, event.seriesKey);
    }
  });
});
