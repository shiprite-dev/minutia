import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

// Fake mic so getUserMedia + MediaRecorder produce real data with no prompt.
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
  permissions: ["microphone"],
});

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

async function createLiveMeetingFixture(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Audio capture coverage ${stamp}`,
      description: "Created by audio capture functional coverage.",
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
      title: `Audio capture session ${stamp}`,
      date: "2026-06-23",
      attendees: ["Alice", "Bob"],
      status: "live",
      notes_markdown: "",
      transcript_raw: null,
      completed_at: null,
    },
  });

  return { seriesId, meetingId };
}

test.describe("Meeting audio capture", () => {
  test("records during live capture and uploads audio on meeting end", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated audio fixtures");
    test.setTimeout(60_000);

    const fixture = await createLiveMeetingFixture(request);
    const audioPath = `${fixture.meetingId}/recording.webm`;

    try {
      // Meeting is seeded live, so navigate straight into live capture (avoids
      // the start-or-join redirect race that would change the meeting id).
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);
      await expect(page.getByText("Live").first()).toBeVisible();

      await page.getByRole("button", { name: "Record meeting audio" }).click();

      // Recording indicator with a live timer is shown.
      await expect(page.getByLabel("Recording time")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Stop recording" })
      ).toBeVisible();

      // Capture a few seconds of audio so MediaRecorder emits chunks.
      await page.waitForTimeout(3000);

      // End the meeting; the recording uploads before completion.
      await page.getByRole("button", { name: "End meeting" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "End meeting" }).click();
      await expect(page.getByText("Meeting recap")).toBeVisible({
        timeout: 30_000,
      });

      // The meeting row points at a durable file queued for transcription.
      await expect
        .poll(
          async () => {
            const rows = await rest(
              request,
              `meetings?id=eq.${fixture.meetingId}&select=audio_file_path,audio_file_size_bytes,transcription_status`
            );
            return rows[0];
          },
          { timeout: 20_000 }
        )
        .toMatchObject({
          audio_file_path: audioPath,
          transcription_status: "pending",
        });

      const rows = await rest(
        request,
        `meetings?id=eq.${fixture.meetingId}&select=audio_file_size_bytes`
      );
      expect(rows[0].audio_file_size_bytes).toBeGreaterThan(0);

      // The object actually exists in the private storage bucket.
      const object = await request.get(
        `${SUPABASE_URL}/storage/v1/object/meeting-audio/${audioPath}`,
        { headers: serviceHeaders() }
      );
      expect(object.ok()).toBeTruthy();
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
