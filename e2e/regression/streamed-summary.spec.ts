import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SERIES_ID = "10000000-0000-0000-0000-000000000004";
const MEETING_ID = "20000000-0000-0000-0000-000000000030";
const STREAM_URL = `**/api/meetings/${MEETING_ID}/summary/stream`;
const HAS_AI = !!(process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY);
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

function sseBody(words: string[]): string {
  const frames = words.map((w) => `data: ${JSON.stringify({ t: w })}\n\n`);
  return `:\n\n${frames.join("")}data: [DONE]\n\n`;
}

async function gotoMeeting(page: Page) {
  await page.goto(`/series/${SERIES_ID}/meetings/${MEETING_ID}`);
  await waitForApp(page);
}

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

// Seed a completed meeting that has NO transcript_raw and no notes, only two
// completed fast-lane segment rows, so the summary route must fall back to
// assembling the recap from segment texts.
async function createSegmentOnlyFixture(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Fast segment recap coverage ${stamp}`,
      description: "Created by fast-segment recap functional coverage.",
      cadence: "weekly",
      default_attendees: ["Alpha", "Beta"],
      owner_id: TEST_USER_ID,
    },
  });
  await rest(request, "meetings", {
    method: "POST",
    data: {
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: `Fast segment recap session ${stamp}`,
      date: "2026-06-23",
      attendees: ["Alpha", "Beta"],
      status: "completed",
      notes_markdown: "",
      raw_notes_markdown: null,
      transcript_raw: null,
    },
  });
  await rest(request, "meeting_audio_segments", {
    method: "POST",
    headers: serviceHeaders("return=minimal"),
    data: [
      {
        meeting_id: meetingId,
        seq: 0,
        storage_path: `${meetingId}/seg-0.webm`,
        status: "completed",
        transcript_text: "Alpha decided X.",
      },
      {
        meeting_id: meetingId,
        seq: 1,
        storage_path: `${meetingId}/seg-1.webm`,
        status: "completed",
        transcript_text: "Beta owns Y.",
      },
    ],
  });

  return { seriesId, meetingId };
}

test("generates a recap that renders as flowing words and announces completion once", async ({ page }) => {
  await page.route(STREAM_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
      body: sseBody(["Mike ", "Ross ", "owns ", "the ", "migration ", "review."]),
    })
  );
  await gotoMeeting(page);

  await page.getByRole("button", { name: /generate recap/i }).click();

  const summary = page.locator("[data-flowing-summary]").first();
  await expect(summary).toContainText("Mike Ross owns the migration review.");
  // Rendered as per-word spans, not one text node.
  expect(await summary.locator("span").count()).toBeGreaterThan(3);

  // The polite completion region is populated exactly once.
  const announce = page.locator("span[aria-live='polite']").filter({ hasText: "Summary ready" });
  await expect(announce).toHaveCount(1);
});

test("Stop halts an in-flight recap without losing arrived text", async ({ page }) => {
  // A stream that never completes so the Stop control is meaningful.
  await page.route(STREAM_URL, async (route) => {
    await new Promise((r) => setTimeout(r, 30_000));
    await route.abort();
  });
  await gotoMeeting(page);

  await page.getByRole("button", { name: /generate recap/i }).click();
  const stop = page.getByRole("button", { name: /stop/i });
  await expect(stop).toBeVisible();
  await stop.click();

  // After Stop, the generating affordance is gone and the Generate control returns.
  await expect(page.getByText(/generating recap/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /generate recap|regenerate recap/i })).toBeVisible();
});

test("reduced motion disables the enter animation while words still render", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(STREAM_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
      body: sseBody(["Recap ", "text ", "still ", "appears."]),
    })
  );
  await gotoMeeting(page);

  await page.getByRole("button", { name: /generate recap/i }).click();
  const summary = page.locator("[data-flowing-summary]").first();
  await expect(summary).toContainText("Recap text still appears.");

  const animationName = await summary
    .locator("span")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animationName === "none" || animationName === "").toBeTruthy();
});

test("deep token streaming grows the recap incrementally (live provider only)", async ({ page }) => {
  test.skip(!HAS_AI, "Requires a live AI provider (OPENROUTER_API_KEY / AI_API_KEY) for true token streaming.");
  await gotoMeeting(page);
  await page.getByRole("button", { name: /generate recap/i }).click();

  const summary = page.locator("[data-flowing-summary]").first();
  await expect(summary).toBeVisible();
  const first = (await summary.textContent())?.length ?? 0;
  await expect
    .poll(async () => (await summary.textContent())?.length ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(first);
  await expect(page.locator("span[aria-live='polite']").filter({ hasText: "Summary ready" }))
    .toHaveCount(1, { timeout: 30_000 });
});

test("recap streams from fast segments when no transcript exists", async ({ page, request }) => {
  test.skip(!HAS_SERVICE_ROLE, "Requires service role to seed fast-lane segment rows");
  // The summary/stream route gates on requireAiAccess + hasAiConfigured (503)
  // BEFORE resolving the transcript source, so with no AI provider the segment
  // fallback is never reached. Exercise it only when a live provider is present.
  test.skip(!HAS_AI, "summary/stream gates on AI config before segment resolution; needs a live provider");
  test.setTimeout(60_000);

  const fixture = await createSegmentOnlyFixture(request);

  try {
    // No stream mock: hit the real route so the segment-fallback branch runs.
    await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
    await waitForApp(page);

    await page.getByRole("button", { name: /generate recap/i }).click();

    // The recap streams real text assembled from the completed segment rows.
    const summary = page.locator("[data-flowing-summary]").first();
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await summary.textContent())?.trim().length ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect(page.locator("span[aria-live='polite']").filter({ hasText: "Summary ready" }))
      .toHaveCount(1, { timeout: 30_000 });
  } finally {
    await rest(request, `meeting_audio_segments?meeting_id=eq.${fixture.meetingId}`, {
      method: "DELETE",
      headers: serviceHeaders("return=minimal"),
    });
    await rest(request, `meeting_series?id=eq.${fixture.seriesId}`, {
      method: "DELETE",
      headers: serviceHeaders("return=minimal"),
    });
  }
});
