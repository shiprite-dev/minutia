import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { waitForApp } from "./seed-data";

// A Mac user agent routes recording to the desktop app; these journeys are
// about the web meeting page, so pin a Linux browser.
test.use({
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
});

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_HELP =
  "This workspace has not been set up for transcription yet. Ask your administrator.";

function serviceHeaders(prefer = "return=representation") {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this test");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function rest(
  request: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {},
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers ?? {}) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

// A meeting the desktop app finished an hour ago: the recording was saved, but
// the transcription request never got past the provider check.
async function createStuckMeeting(
  request: APIRequestContext,
  errorCode: string | null,
) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Stalled transcription ${stamp}`,
      description: "Created by stalled transcription coverage.",
      cadence: "weekly",
      default_attendees: [],
      owner_id: TEST_USER_ID,
    },
  });
  await rest(request, "meetings", {
    method: "POST",
    data: {
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: `Stalled transcription session ${stamp}`,
      date: "2026-11-16",
      attendees: [],
      status: "completed",
      notes_markdown: "",
      audio_file_path: `${meetingId}/recording.m4a`,
      transcription_status: "pending",
      transcription_error_code: errorCode,
      completed_at: anHourAgo,
    },
  });
  return { seriesId, meetingId };
}

async function deleteSeries(request: APIRequestContext, id: string) {
  await rest(request, `meeting_series?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

function statusRegion(page: Page) {
  return page.getByRole("region", { name: "Transcription status" });
}

async function openMeeting(page: Page, seriesId: string, meetingId: string) {
  await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
  await waitForApp(page);
}

test.describe("Stalled transcription", () => {
  test("a recording the desktop app saved on an unconfigured workspace asks for an administrator and can be retried once it is fixed", async ({
    page,
    request,
  }) => {
    test.skip(
      !HAS_SERVICE_ROLE,
      "Requires service role for isolated transcription fixtures",
    );
    const fixture = await createStuckMeeting(
      request,
      "transcription_unconfigured",
    );

    try {
      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await expect(region.getByText(ADMIN_HELP)).toBeVisible();
      await expect(
        region.getByRole("button", {
          name: "Contact administrator",
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(
        page.getByText("Recording saved. Preparing transcription…"),
      ).toHaveCount(0);

      // The stored code may be stale (an admin added a key since), so a retry
      // is offered. A retry that fails the same way again offers none.
      const transcribeCalls: string[] = [];
      await page.route("**/api/meetings/*/transcribe", (route) => {
        transcribeCalls.push(new URL(route.request().url()).pathname);
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Transcription is not configured.",
            code: "TRANSCRIPTION_UNCONFIGURED",
          }),
        });
      });
      await region
        .getByRole("button", { name: "Retry transcription", exact: true })
        .click();
      await expect.poll(() => transcribeCalls).toEqual([
        `/api/meetings/${fixture.meetingId}/transcribe`,
      ]);
      await expect(region.getByText(ADMIN_HELP)).toBeVisible();
      await expect(
        region.getByRole("button", {
          name: "Retry transcription",
          exact: true,
        }),
      ).toHaveCount(0);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("a recording stuck before transcription can be retried from the meeting page", async ({
    page,
    request,
  }) => {
    test.skip(
      !HAS_SERVICE_ROLE,
      "Requires service role for isolated transcription fixtures",
    );
    const fixture = await createStuckMeeting(request, null);
    const transcribeCalls: string[] = [];

    try {
      await page.route("**/api/meetings/*/transcribe", (route) => {
        transcribeCalls.push(new URL(route.request().url()).pathname);
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Transcription is not configured.",
            code: "TRANSCRIPTION_UNCONFIGURED",
          }),
        });
      });

      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await expect(
        region.getByText("Transcription is taking longer than expected."),
      ).toBeVisible();
      await expect(
        page.getByText("Recording saved. Preparing transcription…"),
      ).toHaveCount(0);

      await region
        .getByRole("button", { name: "Retry transcription", exact: true })
        .click();

      await expect(region.getByText(ADMIN_HELP)).toBeVisible();
      expect(transcribeCalls).toEqual([
        `/api/meetings/${fixture.meetingId}/transcribe`,
      ]);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("a participant who does not run the series cannot rewrite why transcription failed", async ({
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated fixtures");
    const fixture = await createStuckMeeting(request, null);
    const email = `stall-participant-${Date.now()}@example.com`;
    const created = await request.post(`${SUPABASE_URL}/auth/v1/admin/users`, {
      headers: serviceHeaders(),
      data: { email, password: "password123", email_confirm: true },
    });
    expect(created.ok()).toBeTruthy();
    const userId = ((await created.json()).id) as string;

    try {
      await rest(request, "series_participants", {
        method: "POST",
        data: { series_id: fixture.seriesId, user_id: userId, role: "participant" },
      });
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const token = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        data: { email, password: "password123" },
      });
      expect(token.ok()).toBeTruthy();
      const accessToken = (await token.json()).access_token as string;

      const update = await request.patch(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${fixture.meetingId}`,
        {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          data: { title: "Renamed by a participant", transcription_error_code: "no_api_key" },
        },
      );
      expect(update.ok(), await update.text()).toBeTruthy();

      const [row] = await rest(
        request,
        `meetings?id=eq.${fixture.meetingId}&select=title,transcription_error_code`,
      );
      expect(row.title).toBe("Renamed by a participant");
      expect(row.transcription_error_code).toBeNull();
    } finally {
      await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        headers: serviceHeaders(),
      });
      await deleteSeries(request, fixture.seriesId);
    }
  });
});
