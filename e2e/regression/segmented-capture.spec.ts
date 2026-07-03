import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

// Fake mic so getUserMedia + MediaRecorder produce real audio/webm with no
// prompt. Chromium's fake device records WebM by default, so the fast lane is
// active and the segment cutting path exercises for real.
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

async function removeStorageObject(request: APIRequestContext, path: string) {
  await request
    .delete(`${SUPABASE_URL}/storage/v1/object/meeting-audio/${path}`, {
      headers: serviceHeaders("return=minimal"),
    })
    .catch(() => undefined);
}

async function createLiveMeetingFixture(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Segmented capture coverage ${stamp}`,
      description: "Created by segmented capture functional coverage.",
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
      title: `Segmented capture session ${stamp}`,
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

// SSE body identical in shape to streamed-summary.spec.ts's mock so the recap
// materializes from a deterministic stream with no live provider.
function sseBody(words: string[]): string {
  const frames = words.map((w) => `data: ${JSON.stringify({ t: w })}\n\n`);
  return `:\n\n${frames.join("")}data: [DONE]\n\n`;
}

test.describe("Segmented fast-lane capture", () => {
  test("stop cuts a tail segment, fast-lane transcribes it, recap auto-flows", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated capture fixtures");
    test.setTimeout(90_000);

    const fixture = await createLiveMeetingFixture(request);
    const recapWords = ["Segment ", "recap ", "flows ", "on ", "stop."];

    // Capture every fast-lane segment transcribe POST so we can assert exactly
    // one tail segment (seg-0) fired with the contract-exact storage path.
    const segmentPaths: string[] = [];

    // Hold the segment transcribe until the completed view (and its recap
    // region) is on screen, mirroring real provider latency: the fast segment
    // finishes a beat AFTER the meeting ends. This makes fast-lane readiness
    // land as a post-mount `autoStart` flip, the path the auto-flow takes for a
    // real user, rather than racing the live->completed remount.
    let releaseSegment: () => void = () => {};
    const segmentGate = new Promise<void>((resolve) => {
      releaseSegment = resolve;
    });

    // Disjoint URL predicates: the segment route carries `/segments/{seq}/` and
    // the final route does not, so the final glob can never swallow the segment
    // route regardless of registration order.
    await page.route(
      (url) => /\/api\/meetings\/[^/]+\/segments\/\d+\/transcribe$/.test(url.pathname),
      async (route) => {
        const body = route.request().postDataJSON() as { path?: string };
        segmentPaths.push(body?.path ?? "");
        await segmentGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "completed",
            seq: 0,
            transcript_length: 42,
            request_id: "e2e",
          }),
        });
      }
    );

    await page.route(`**/api/meetings/${fixture.meetingId}/summary/stream`, (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
        },
        body: sseBody(recapWords),
      })
    );

    // The final (non-segment) transcribe route: stub so stop's fire-and-forget
    // runTranscription() never depends on a real provider. Must be registered
    // and predicated so it excludes the segment route above.
    await page.route(
      (url) =>
        /\/api\/meetings\/[^/]+\/transcribe$/.test(url.pathname) &&
        !/\/segments\//.test(url.pathname),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "completed" }),
        })
    );

    try {
      // Meeting is seeded live, so navigate straight into live capture.
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);
      await expect(page.getByText("Live").first()).toBeVisible();

      await page.getByRole("button", { name: "Record meeting audio" }).click();
      await expect(page.getByLabel("Recording time")).toBeVisible();

      // Record long enough for MediaRecorder to emit multiple WebM clusters so
      // flushFinal has whole clusters to cut into the tail segment.
      await page.waitForTimeout(4000);

      // End the meeting: this stops recording (recorder.state -> "stopped",
      // flushFinal cuts the tail segment) and flips the meeting to completed so
      // the recap region mounts. The recap surfaces only in the completed view,
      // so ending is the real path.
      await page.getByRole("button", { name: "End meeting" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "End meeting" })
        .click();
      await expect(page.getByText("Meeting complete")).toBeVisible({ timeout: 30_000 });

      // The seg-0 transcribe POST fired the moment recording stopped; the recap
      // region is now mounted, so let the segment finish and the fast lane turn
      // ready, which auto-flows the recap.
      await expect
        .poll(() => segmentPaths.length, { timeout: 30_000 })
        .toBeGreaterThan(0);
      releaseSegment();

      // The recap materializes the mocked stream WITHOUT any generate click.
      const summary = page.locator("[data-flowing-summary]").first();
      await expect(summary).toContainText("Segment recap flows on stop.", {
        timeout: 45_000,
      });

      // Exactly one tail segment was cut and transcribed, at the contract path.
      expect(segmentPaths).toEqual([`${fixture.meetingId}/seg-0.webm`]);
    } finally {
      releaseSegment();
      await removeStorageObject(request, `${fixture.meetingId}/recording.webm`);
      await removeStorageObject(request, `${fixture.meetingId}/seg-0.webm`);
      await deleteSeries(request, fixture.seriesId);
    }
  });
});
