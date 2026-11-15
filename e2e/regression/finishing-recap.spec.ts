import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const CATCHING = "Catching the last few minutes";
const FINAL_TRANSCRIPT =
  "Test User: We ship the rollout on Friday.\n\nMike Ross: I will book the vendor review.\n\nTest User: Thanks everyone, that is a wrap.";

function serviceHeaders(prefer = "return=minimal") {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
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
  expect(
    response.ok(),
    `${response.status()} ${await response.text()}`,
  ).toBeTruthy();
}

interface Fixture {
  seriesId: string;
  meetingId: string;
  url: string;
}

async function stoppedMeeting(request: APIRequestContext): Promise<Fixture> {
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Finishing coverage ${Date.now()}`,
      cadence: "weekly",
      default_attendees: ["Test User", "Mike Ross"],
      owner_id: TEST_USER_ID,
    },
  });
  await rest(request, "meetings", {
    method: "POST",
    data: {
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: `Companion stop ${Date.now()}`,
      attendees: ["Test User", "Mike Ross"],
      status: "completed",
      completed_at: new Date().toISOString(),
      transcript_raw: null,
    },
  });
  await addWindow(request, meetingId, 0, "We ship the rollout on Friday.");
  await addWindow(request, meetingId, 1, "I will book the vendor review.");
  return {
    seriesId,
    meetingId,
    url: `/series/${seriesId}/meetings/${meetingId}`,
  };
}

async function addWindow(
  request: APIRequestContext,
  meetingId: string,
  seq: number,
  text: string,
) {
  await rest(request, "meeting_audio_segments", {
    method: "POST",
    data: {
      meeting_id: meetingId,
      seq,
      storage_path: `${meetingId}/seg-${seq}-me.m4a`,
      status: "completed",
      transcript_text: text,
    },
  });
}

async function patchMeeting(
  request: APIRequestContext,
  meetingId: string,
  data: Record<string, unknown>,
) {
  await rest(request, `meetings?id=eq.${meetingId}`, { method: "PATCH", data });
}

async function deleteFixture(request: APIRequestContext, fixture: Fixture) {
  await rest(request, `meeting_series?id=eq.${fixture.seriesId}`, {
    method: "DELETE",
  });
}

async function countRecapStreams(page: Page, meetingId: string) {
  const counter = { calls: 0 };
  const path = `/api/meetings/${meetingId}/summary/stream`;
  await page.route(
    (url) => url.pathname === path,
    (route) => {
      counter.calls += 1;
      const frames = ["Fresh ", "recap ", "from ", "the ", "stream."]
        .map((w) => `data: ${JSON.stringify({ t: w })}\n\n`)
        .join("");
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-summary-model": "test-model-x",
        },
        body: `:\n\n${frames}data: [DONE]\n\n`,
      });
    },
  );
  return counter;
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await waitForApp(page);
  await expect(page.getByText("Meeting recap", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("Recap page opened at stop", () => {
  test.skip(!HAS_SERVICE_ROLE, "Requires service role for capture fixtures");

  test("a meeting opened at stop shows what was already heard, then writes its recap once the last minutes land", async ({
    page,
    request,
  }) => {
    const fixture = await stoppedMeeting(request);
    try {
      const streams = await countRecapStreams(page, fixture.meetingId);

      await open(page, fixture.url);
      await expect(page.locator("[data-finishing-transcript]")).toHaveCount(0);
      await expect(page.getByText(CATCHING)).toHaveCount(0);

      await open(page, `${fixture.url}?recap=auto`);
      const heard = page.locator("[data-finishing-transcript]");
      await expect(heard).toContainText("We ship the rollout on Friday.");
      await expect(heard).toContainText("I will book the vendor review.");
      const shown = (await heard.innerText()).trim();
      expect(shown.indexOf("We ship the rollout")).toBeLessThan(
        shown.indexOf("I will book the vendor review"),
      );
      await expect(heard.getByText(CATCHING)).toBeVisible();
      await expect(page).not.toHaveURL(/recap=auto/);
      expect(streams.calls).toBe(0);

      await addWindow(
        request,
        fixture.meetingId,
        2,
        "Thanks everyone, that is a wrap.",
      );
      await expect(heard).toContainText("Thanks everyone, that is a wrap.", {
        timeout: 10_000,
      });
      expect(streams.calls).toBe(0);

      await patchMeeting(request, fixture.meetingId, {
        transcript_raw: FINAL_TRANSCRIPT,
        transcription_status: "completed",
        transcription_completed_at: new Date().toISOString(),
      });

      await expect(page.getByText(CATCHING)).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(heard).toHaveCount(0);
      await expect(page.getByPlaceholder("Paste transcript...")).toHaveValue(
        /Mike Ross: I will book the vendor review\./,
      );
      await expect(page.locator("[data-flowing-summary]")).toContainText(
        "Fresh recap from the stream.",
        { timeout: 15_000 },
      );
      expect(streams.calls).toBe(1);

      await page.reload();
      await waitForApp(page);
      await expect(
        page.getByText("Meeting recap", { exact: true }),
      ).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(3_000);
      expect(streams.calls).toBe(1);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("a stop whose transcription fails leaves the finishing view for a retry and writes no recap", async ({
    page,
    request,
  }) => {
    const fixture = await stoppedMeeting(request);
    try {
      const streams = await countRecapStreams(page, fixture.meetingId);
      await open(page, `${fixture.url}?recap=auto`);
      await expect(page.getByText(CATCHING)).toBeVisible();

      await patchMeeting(request, fixture.meetingId, {
        transcription_status: "failed",
      });

      await expect(page.getByText(CATCHING)).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(page.locator("[data-finishing-transcript]")).toHaveCount(0);
      await expect(
        page.getByText("Transcription did not finish."),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Retry transcription" }),
      ).toBeVisible();
      expect(streams.calls).toBe(0);
    } finally {
      await deleteFixture(request, fixture);
    }
  });
});
