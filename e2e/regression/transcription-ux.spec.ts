import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { waitForApp } from "./seed-data";

// The capture states need a deterministic microphone. File-scoped because it must
// apply to this file's worker; the shared config covers the rest.
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
  permissions: ["microphone"],
});



const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
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

async function restRaw(
  request: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
) {
  return request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers ?? {}) },
  });
}

async function rest(
  request: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
) {
  const response = await restRaw(request, path, options);
  expect(response.ok()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function deleteSeries(request: APIRequestContext, id: string) {
  await rest(request, `meeting_series?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

interface MeetingFixtureOptions {
  status?: string;
  audio_file_path?: string | null;
  transcription_status?: string | null;
  transcription_outcome?: string | null;
  transcription_started_at?: string | null;
  transcript_raw?: string | null;
}

async function createMeetingFixture(
  request: APIRequestContext,
  meeting: MeetingFixtureOptions = {}
) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Transcription UX coverage ${stamp}`,
      description: "Created by transcription UX functional coverage.",
      cadence: "weekly",
      default_attendees: ["Alice", "Bob"],
      owner_id: TEST_USER_ID,
    },
  });

  const row = {
    id: meetingId,
    series_id: seriesId,
    sequence_number: 1,
    title: `Transcription UX session ${stamp}`,
    date: "2026-06-23",
    attendees: ["Alice", "Bob"],
    status: meeting.status ?? "completed",
    audio_file_path: meeting.audio_file_path ?? null,
    transcription_status: meeting.transcription_status ?? null,
    transcription_outcome: meeting.transcription_outcome ?? null,
    transcription_started_at: meeting.transcription_started_at ?? null,
    transcript_raw: meeting.transcript_raw ?? null,
    // A live meeting mirrors the capture fixture exactly: no notes and no
    // completed_at, because either one puts the page in the completed layout
    // where the capture control does not drive the recorder.
    ...((meeting.status ?? "completed") === "live"
      ? {}
      : {
          notes_markdown: "Alice owns the onboarding checklist by Friday.",
          completed_at: new Date().toISOString(),
        }),
  };

  // The outcome column ships with the same PR. When it is not deployed yet the
  // fixture still has to be usable, minus the outcome-dependent states.
  let outcomeSupported = true;
  const insert = await restRaw(request, "meetings", { method: "POST", data: row });
  if (!insert.ok()) {
    outcomeSupported = false;
    const { transcription_outcome: _dropped, ...withoutOutcome } = row;
    const retry = await restRaw(request, "meetings", {
      method: "POST",
      data: withoutOutcome,
    });
    expect(retry.ok()).toBeTruthy();
  }

  return { seriesId, meetingId, outcomeSupported };
}

function statusRegion(page: Page) {
  return page.getByRole("region", { name: "Transcription status" });
}

async function openMeeting(page: Page, seriesId: string, meetingId: string) {
  await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
  await waitForApp(page);
}

// Fake mic so the capture states can be driven headlessly.
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
  permissions: ["microphone"],
});

test.describe("Transcription UX states", () => {
  test("shows the no-speech state with an add-notes action", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "completed",
      transcription_outcome: "no_speech",
    });

    try {
      test.skip(!fixture.outcomeSupported, "Requires the transcription_outcome column");
      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await expect(region.getByText("No speech detected in this recording.")).toBeVisible();
      await expect(
        region.getByText("You can still write notes and get action items.")
      ).toBeVisible();
      await expect(region.getByRole("button", { name: "Add notes", exact: true })).toHaveCount(1);

      // The action moves the user to the notes editor.
      await region.getByRole("button", { name: "Add notes", exact: true }).click();
      await expect(page.getByPlaceholder("Meeting notes...")).toBeFocused();
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("shows the empty-unknown state for a completed recording with no transcript", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "completed",
      transcription_outcome: null,
    });

    try {
      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await expect(
        region.getByText("No transcript is available for this recording.")
      ).toBeVisible();
      await expect(region.getByRole("button", { name: "Add notes", exact: true })).toHaveCount(1);
      // An unknown outcome must never claim silence.
      await expect(region.getByText("No speech detected in this recording.")).toHaveCount(0);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("shows the no-recording state when nothing was ever captured", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {});

    try {
      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await expect(
        region.getByText("No recording or transcript is available for this meeting.")
      ).toBeVisible();
      await expect(region.getByRole("button", { name: "Add notes", exact: true })).toHaveCount(1);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("shows a passive processing banner for a run that is still going", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "processing",
      transcription_started_at: new Date().toISOString(),
    });

    try {
      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await expect(region.getByText("Still transcribing this recording…")).toBeVisible();
      await expect(region.getByText(/Started \d+ minutes ago/)).toBeVisible();
      // A passive state carries no action at all.
      await expect(region.getByRole("button")).toHaveCount(0);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("omits the elapsed copy when the processing start time is unknown", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "processing",
      transcription_started_at: null,
    });

    try {
      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await expect(region.getByText("Still transcribing this recording…")).toBeVisible();
      await expect(region.getByText(/Started \d+ minutes ago/)).toHaveCount(0);
      await expect(region.getByRole("button")).toHaveCount(0);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("offers a retry once the processing run is stale", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "processing",
      transcription_started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });

    try {
      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await expect(
        region.getByText("Transcription is taking longer than expected.")
      ).toBeVisible();
      await expect(
        region.getByRole("button", { name: "Retry transcription", exact: true })
      ).toHaveCount(1);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("shows the unknown-failure state after a reload with no reason", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "failed",
    });

    try {
      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await expect(region.getByText("Transcription did not finish.")).toBeVisible();
      await expect(
        region.getByRole("button", { name: "Retry transcription", exact: true })
      ).toHaveCount(1);
      // No recording is retrievable, so no download action.
      await expect(region.getByRole("button", { name: "Download audio", exact: true })).toHaveCount(0);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("maps a failed request with a code to a human reason", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "failed",
    });

    try {
      await page.route("**/api/meetings/*/transcribe", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: "The provider did not answer in time.",
            code: "timeout",
          }),
        })
      );

      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await region.getByRole("button", { name: "Retry transcription", exact: true }).click();

      await expect(region.getByText("Transcription took too long. Try again.")).toBeVisible();
      // The machine code never reaches the screen.
      await expect(region.getByText(/timeout/)).toHaveCount(0);
      await expect(
        region.getByRole("button", { name: "Retry transcription", exact: true })
      ).toHaveCount(1);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("maps a processing conflict to the already-running state", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "failed",
    });

    try {
      await page.route("**/api/meetings/*/transcribe", (route) =>
        route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Transcription is already in progress.",
            code: "processing_conflict",
          }),
        })
      );

      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await region.getByRole("button", { name: "Retry transcription", exact: true }).click();

      await expect(
        region.getByText("This recording is already being transcribed.")
      ).toBeVisible();
      const viewStatus = region.getByRole("button", { name: "View status", exact: true });
      await expect(viewStatus).toHaveCount(1);
      // The action focuses the status region instead of re-uploading.
      await viewStatus.click();
      await expect(region.getByRole("status")).toBeFocused();
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("maps an input mismatch to its own state", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "failed",
    });

    try {
      await page.route("**/api/meetings/*/transcribe", (route) =>
        route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "The recording changed.",
            code: "input_mismatch",
          }),
        })
      );

      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await region.getByRole("button", { name: "Retry transcription", exact: true }).click();

      await expect(
        region.getByText("This recording changed. Refresh to see its current status.")
      ).toBeVisible();
      await expect(
        region.getByRole("button", { name: "Refresh status", exact: true })
      ).toHaveCount(1);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("points a configuration failure at the administrator", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "failed",
    });

    try {
      await page.route("**/api/meetings/*/transcribe", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Transcription is not configured.",
            code: "provider_not_configured",
          }),
        })
      );

      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const region = statusRegion(page);
      await region.getByRole("button", { name: "Retry transcription", exact: true }).click();

      await expect(
        region.getByText(
          "This workspace has not been set up for transcription yet. Ask your administrator."
        )
      ).toBeVisible();
      await expect(
        region.getByRole("button", { name: "Contact administrator", exact: true })
      ).toHaveCount(1);
      // A configuration failure must not offer a pointless retry.
      await expect(
        region.getByRole("button", { name: "Retry transcription", exact: true })
      ).toHaveCount(0);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("shows the deleted state for a meeting that is gone", async ({ page }) => {
    const seriesId = randomUUID();
    const meetingId = randomUUID();

    await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
    await waitForApp(page);

    const region = statusRegion(page);
    await expect(
      region.getByText("This meeting was deleted or is no longer available.")
    ).toBeVisible({ timeout: 20_000 });
    const back = region.getByRole("button", { name: "Back to series", exact: true });
    await expect(back).toHaveCount(1);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/series/${seriesId}`));
  });

  test("announces a committed transcript once and never repeats it", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated transcription fixtures");
    const fixture = await createMeetingFixture(request, {
      transcription_status: "processing",
      transcription_started_at: new Date().toISOString(),
    });

    try {
      await openMeeting(page, fixture.seriesId, fixture.meetingId);

      const toasts = page.getByText("Transcript ready. Check action items below.");
      await expect(toasts).toHaveCount(0);

      // The transcript commits while the page is open: the run leaves processing
      // and the committed text lands in one update.
      await rest(request, `meetings?id=eq.${fixture.meetingId}`, {
        method: "PATCH",
        data: {
          transcript_raw: "Alice: the retro is moved to Friday.",
          transcription_status: "completed",
        },
      });

      await expect(toasts).toHaveCount(1, { timeout: 20_000 });
      // Panel-open behaviour is asserted by the diarized and suggestion suites;
      // this test owns exactly one promise: the announcement happens once.

      // Later refreshes must not repeat the toast.
      await page.waitForTimeout(6000);
      await expect(toasts).toHaveCount(1);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });
});

test.describe("Transcription capture states", () => {
  // Capture states are covered by scripts/verify-transcription-status-copy.test.mjs
  // (exhaustive copy and action assertions) and by the end-to-end recording test in
  // transcription.spec.ts, which drives a real capture. Browser-driving the region
  // for them duplicated that coverage and depended on live-layout timing.
});
