import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

test.use({
  locale: "ja-JP",
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
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
  expect(response.ok()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function removeStorageObject(request: APIRequestContext, path: string) {
  await request
    .delete(`${SUPABASE_URL}/storage/v1/object/meeting-audio/${path}`, {
      headers: serviceHeaders("return=minimal"),
    })
    .catch(() => undefined);
}

async function createLiveMeeting(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Transcription language ${stamp}`,
      description: "Created by transcription language coverage.",
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
      title: `Transcription language session ${stamp}`,
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

test.describe("Transcription language", () => {
  test("recording a meeting sends the browser language with the transcription request", async ({
    page,
    request,
  }) => {
    test.skip(
      !HAS_SERVICE_ROLE,
      "Requires service role for isolated capture fixtures",
    );
    test.setTimeout(90_000);

    const fixture = await createLiveMeeting(request);
    const segmentBodies: Record<string, unknown>[] = [];
    const finalBodies: Record<string, unknown>[] = [];

    await page.route(
      (url) =>
        /\/api\/meetings\/[^/]+\/segments\/\d+\/transcribe$/.test(url.pathname),
      async (route) => {
        segmentBodies.push(route.request().postDataJSON() ?? {});
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "completed",
            seq: 0,
            transcript_length: 12,
            request_id: "e2e",
          }),
        });
      },
    );
    await page.route(
      (url) =>
        /\/api\/meetings\/[^/]+\/transcribe$/.test(url.pathname) &&
        !/\/segments\//.test(url.pathname),
      async (route) => {
        finalBodies.push(route.request().postDataJSON() ?? {});
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "completed",
            outcome: "speech",
            transcript_length: 12,
            request_id: "e2e",
          }),
        });
      },
    );

    try {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgentData", {
          configurable: true,
          get: () => ({ platform: "Linux" }),
        });
      });
      await page.goto(
        `/series/${fixture.seriesId}/meetings/${fixture.meetingId}`,
      );
      await waitForApp(page);
      const browserLanguage = await page.evaluate(() => navigator.language);
      expect(browserLanguage).toBe("ja-JP");

      await page.getByRole("button", { name: "Record meeting audio" }).click();
      await expect(page.getByLabel("Recording time")).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(4000);

      await page.getByRole("button", { name: "End meeting" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "End meeting" })
        .click();
      await expect(page.getByText("Meeting recap")).toBeVisible({
        timeout: 30_000,
      });

      await expect
        .poll(() => segmentBodies.length + finalBodies.length, {
          timeout: 30_000,
        })
        .toBeGreaterThan(0);
      await expect
        .poll(() => finalBodies.length, { timeout: 30_000 })
        .toBeGreaterThan(0);

      for (const body of [...segmentBodies, ...finalBodies]) {
        expect(body.language).toBe(browserLanguage);
      }
    } finally {
      await removeStorageObject(request, `${fixture.meetingId}/recording.webm`);
      await removeStorageObject(request, `${fixture.meetingId}/seg-0.webm`);
      await rest(request, `meeting_series?id=eq.${fixture.seriesId}`, {
        method: "DELETE",
        headers: serviceHeaders("return=minimal"),
      });
    }
  });
});
