import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_GROQ = !!process.env.GROQ_API_KEY;
const HAS_TRANSCRIPTION =
  HAS_GROQ || !!process.env.OPENROUTER_API_KEY || !!process.env.AI_API_KEY;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

function serviceHeaders(prefer = "return=representation") {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this test");
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
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers ?? {}) },
  });
  expect(response.ok()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function deleteSeries(request: APIRequestContext, id: string) {
  await rest(request, `meeting_series?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

async function createMeetingFixture(
  request: APIRequestContext,
  meeting: { status?: string; audio_file_path?: string | null; transcription_status?: string | null } = {}
) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Transcription coverage ${stamp}`,
      description: "Created by transcription functional coverage.",
      cadence: "weekly",
      default_attendees: ["Alice", "Bob"],
      owner_id: TEST_USER_ID,
    },
  });
  await rest(request, "meetings", {
    method: "POST",
    data: {
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: `Transcription session ${stamp}`,
      date: "2026-06-23",
      attendees: ["Alice", "Bob"],
      status: meeting.status ?? "completed",
      audio_file_path: meeting.audio_file_path ?? null,
      transcription_status: meeting.transcription_status ?? null,
    },
  });

  return { seriesId, meetingId };
}

// Fake mic so the end-to-end recording path works headlessly (launchOptions
// cannot live inside a describe group, so it is file-scoped here).
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
  permissions: ["microphone"],
});

test.describe("Transcription pipeline", () => {
  test("rejects a meeting with no recording before touching a provider", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, { audio_file_path: null });

    try {
      const response = await page.request.post(
        `/api/meetings/${fixture.meetingId}/transcribe`,
        { data: {}, timeout: 20_000 }
      );
      expect(response.status()).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "No audio recording found for this meeting.",
      });
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("is idempotent: refuses to start when one is already processing", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      audio_file_path: "stale/recording.webm",
      transcription_status: "processing",
    });

    try {
      const response = await page.request.post(
        `/api/meetings/${fixture.meetingId}/transcribe`,
        { data: {}, timeout: 20_000 }
      );
      expect(response.status()).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: "Transcription is already in progress.",
      });
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("returns 404 for a meeting the caller cannot see", async ({ page }) => {
    const response = await page.request.post(
      `/api/meetings/${randomUUID()}/transcribe`,
      { data: {}, timeout: 20_000 }
    );
    expect(response.status()).toBe(404);
  });

  test("returns 503 when no transcription provider is configured", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    test.skip(HAS_TRANSCRIPTION, "Requires transcription to be unconfigured");
    const fixture = await createMeetingFixture(request, {
      audio_file_path: "queued/recording.webm",
      transcription_status: "pending",
    });

    try {
      const response = await page.request.post(
        `/api/meetings/${fixture.meetingId}/transcribe`,
        { data: {}, timeout: 20_000 }
      );
      expect(response.status()).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: "Transcription is not configured.",
      });

      // The row must not be left stuck in 'processing' on a config failure.
      const rows = await rest(
        request,
        `meetings?id=eq.${fixture.meetingId}&select=transcription_status`
      );
      expect(rows[0].transcription_status).toBe("pending");
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("transcribes a recorded meeting end to end", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    test.skip(!HAS_GROQ, "Requires GROQ_API_KEY for live transcription coverage");
    test.setTimeout(120_000);

    const fixture = await createMeetingFixture(request, { status: "live" });
    const audioPath = `${fixture.meetingId}/recording.webm`;

    try {
      // Capture real audio through the live meeting flow.
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);
      await page.getByRole("button", { name: "Record meeting audio" }).click();
      await expect(page.getByLabel("Recording time")).toBeVisible();
      await page.waitForTimeout(3000);
      await page.getByRole("button", { name: "End meeting" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "End meeting" }).click();
      await expect(page.getByText("Meeting complete")).toBeVisible({ timeout: 30_000 });

      await expect
        .poll(
          async () => {
            const rows = await rest(
              request,
              `meetings?id=eq.${fixture.meetingId}&select=transcription_status`
            );
            return rows[0]?.transcription_status;
          },
          { timeout: 20_000 }
        )
        .toBe("pending");

      // Now run the transcription pipeline against the stored recording.
      const response = await page.request.post(
        `/api/meetings/${fixture.meetingId}/transcribe`,
        { data: {}, timeout: 90_000 }
      );
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({ status: "completed" });
      expect(payload.provider).toBeTruthy();
      expect(payload.model).toBeTruthy();

      const rows = await rest(
        request,
        `meetings?id=eq.${fixture.meetingId}&select=transcription_status,transcription_provider,transcription_completed_at`
      );
      expect(rows[0].transcription_status).toBe("completed");
      expect(rows[0].transcription_provider).toBeTruthy();
      expect(rows[0].transcription_completed_at).not.toBeNull();
    } finally {
      await request
        .delete(`${SUPABASE_URL}/storage/v1/object/meeting-audio/${audioPath}`, {
          headers: serviceHeaders("return=minimal"),
        })
        .catch(() => undefined);
      await deleteSeries(request, fixture.seriesId);
    }
  });
});

test.describe("Transcription auth", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("rejects unauthenticated transcription requests", async ({ request }) => {
    const response = await request.post(`/api/meetings/${randomUUID()}/transcribe`, { data: {} });
    expect(response.status()).toBe(401);
  });
});
