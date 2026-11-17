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

// The seeded meeting has a transcript and no stored recap, so a manager's first
// visit writes the recap by itself. Reset it before each test so a recap stored
// by an earlier run (or a live provider) never suppresses the auto-start.
test.beforeEach(async ({ request }) => {
  test.skip(!HAS_SERVICE_ROLE, "Requires service role to reset the seeded recap");
  await rest(request, `meetings?id=eq.${MEETING_ID}`, {
    method: "PATCH",
    headers: serviceHeaders("return=minimal"),
    data: { recap_markdown: null, recap_generated_at: null, recap_model: null, notes_markdown: "" },
  });
});

test("a first visit writes the recap as flowing words and announces completion once", async ({ page }) => {
  await page.route(STREAM_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
      body: sseBody(["Mike ", "Ross ", "owns ", "the ", "migration ", "review."]),
    })
  );
  await gotoMeeting(page);

  const summary = page.locator("[data-flowing-summary]").first();
  await expect(summary).toContainText("Mike Ross owns the migration review.");
  // Rendered as per-word spans, not one text node.
  expect(await summary.locator("span").count()).toBeGreaterThan(3);
  await expect(page.getByRole("button", { name: /generate recap/i })).toHaveCount(0);

  // The polite completion region is populated exactly once.
  const announce = page.locator("span[aria-live='polite']").filter({ hasText: "Summary ready" });
  await expect(announce).toHaveCount(1);
});

test("a finished recap carries an AI provenance line naming the model", async ({ page }) => {
  await page.route(STREAM_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-summary-model": "test-model-x",
      },
      body: sseBody(["Mike ", "Ross ", "owns ", "it."]),
    })
  );
  await gotoMeeting(page);

  await expect(page.locator("[data-flowing-summary]").first()).toContainText(
    "Mike Ross owns it."
  );

  const provenance = page.locator("[data-recap-provenance]");
  await expect(provenance).toBeVisible();
  await expect(provenance).toContainText("Written by AI");
  await expect(provenance).toContainText("just now");
  await expect(provenance).toHaveAttribute("title", "test-model-x");
});

test("R never re-runs the recap, on the page or inside a field", async ({ page }) => {
  let calls = 0;
  await page.route(STREAM_URL, (route) => {
    calls += 1;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-summary-model": "test-model-x",
      },
      body: sseBody(["Mike ", "Ross ", "owns ", "it."]),
    });
  });
  await gotoMeeting(page);

  await expect(page.locator("[data-flowing-summary]").first()).toContainText(
    "Mike Ross owns it."
  );
  expect(calls).toBe(1);

  // R inside the notes field types the character.
  const notes = page.getByPlaceholder("Meeting notes...");
  await notes.click();
  await page.keyboard.press("r");
  await expect(notes).toHaveValue("r");

  // R on the page body does nothing either.
  await notes.blur();
  await page.keyboard.press("r");
  await page.waitForTimeout(800);
  expect(calls).toBe(1);
  await expect(page.getByRole("button", { name: "Replay recap" })).toHaveCount(0);
});

test("a first visit asks for the recap exactly once, even while the meeting refreshes", async ({ page }) => {
  await page.addInitScript((path) => {
    const w = window as unknown as { recapRequests: number };
    const original = window.fetch;
    w.recapRequests = 0;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(path)) w.recapRequests += 1;
      return original(input, init);
    };
  }, `/api/meetings/${MEETING_ID}/summary/stream`);
  await page.route(STREAM_URL, async (route) => {
    await new Promise((r) => setTimeout(r, 4_500));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
      body: sseBody(["Mike ", "Ross ", "owns ", "it."]),
    });
  });
  await gotoMeeting(page);

  await expect(page.locator("[data-flowing-summary]").first()).toContainText("Mike Ross owns it.");
  await page.waitForTimeout(2_500);
  expect(
    await page.evaluate(() => (window as unknown as { recapRequests: number }).recapRequests)
  ).toBe(1);
});

test("Stop halts an in-flight recap and offers to try again", async ({ page }) => {
  // A stream that never completes so the Stop control is meaningful.
  let calls = 0;
  await page.route(STREAM_URL, async (route) => {
    calls += 1;
    if (calls === 1) {
      await new Promise((r) => setTimeout(r, 30_000));
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
      body: sseBody(["Second ", "attempt."]),
    });
  });
  await gotoMeeting(page);

  const stop = page.getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible();
  await stop.click();

  await expect(page.getByText("Writing recap…")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Recap progress" })).toHaveCount(0);
  await expect(page.getByText("Recap stopped.")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("[data-flowing-summary]").first()).toContainText("Second attempt.");
  expect(calls).toBe(2);
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

  const summary = page.locator("[data-flowing-summary]").first();
  await expect(summary).toBeVisible();
  const first = (await summary.textContent())?.length ?? 0;
  await expect
    .poll(async () => (await summary.textContent())?.length ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(first);
  await expect(page.locator("span[aria-live='polite']").filter({ hasText: "Summary ready" }))
    .toHaveCount(1, { timeout: 30_000 });
});

test("recap streams from fast segments when no transcript exists and is stored", async ({ page, request }) => {
  test.skip(!HAS_SERVICE_ROLE, "Requires service role to seed fast-lane segment rows");
  // The summary/stream route gates on requireAiAccess + hasAiConfigured (503)
  // BEFORE resolving the transcript source, so with no AI provider the segment
  // fallback is never reached. Exercise it only when a live provider is present.
  test.skip(!HAS_AI, "summary/stream gates on AI config before segment resolution; needs a live provider");
  test.setTimeout(60_000);

  const fixture = await createSegmentOnlyFixture(request);

  try {
    // No stream mock: hit the real route so the segment-fallback branch runs.
    // A segment-only row has no client-visible source, so the page does not
    // auto-start; drive the route the way the post-recording flow does.
    await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
    await waitForApp(page);
    const response = await page.request.post(
      `/api/meetings/${fixture.meetingId}/summary/stream`,
      { timeout: 45_000 }
    );
    expect(response.ok()).toBeTruthy();
    expect(await response.text()).toContain("data: [DONE]");

    // The stored recap is what the next visit reads.
    await page.reload();
    await waitForApp(page);
    const summary = page.locator("[data-flowing-summary]").first();
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await summary.textContent())?.trim().length ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect(page.locator("[data-recap-provenance]")).toContainText("Written by AI");
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
