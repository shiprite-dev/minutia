import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Request,
} from "@playwright/test";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TRANSCRIPT = `Polling transcript body ${"lorem ipsum dolor sit amet ".repeat(200)}`;

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
  options: Parameters<APIRequestContext["fetch"]>[1] = {},
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers ?? {}) },
  });
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

async function createSeries(request: APIRequestContext, name: string) {
  const [profile] = await rest(
    request,
    `profiles?id=eq.${TEST_USER_ID}&select=current_organization_id`,
    { method: "GET" },
  );
  const id = randomUUID();
  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id,
      organization_id: profile.current_organization_id,
      owner_id: TEST_USER_ID,
      name,
      description: "",
      cadence: "weekly",
      default_attendees: ["Test User"],
    },
  });
  await rest(request, "series_participants?on_conflict=series_id,user_id", {
    method: "POST",
    data: {
      series_id: id,
      user_id: TEST_USER_ID,
      role: "owner",
      invited_by: TEST_USER_ID,
    },
    headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
  });
  return id;
}

async function createMeeting(
  request: APIRequestContext,
  seriesId: string,
  fields: Record<string, unknown>,
) {
  const id = randomUUID();
  await rest(request, "meetings", {
    method: "POST",
    data: {
      id,
      series_id: seriesId,
      sequence_number: 1,
      title: `Polling meeting ${id.slice(0, 8)}`,
      date: new Date().toISOString().slice(0, 10),
      attendees: ["Test User"],
      notes_markdown: "Polling notes stay readable",
      ...fields,
    },
  });
  return id;
}

async function raiseIssue(
  request: APIRequestContext,
  seriesId: string,
  meetingId: string,
  title: string,
  status = "open",
) {
  await rest(request, "issues", {
    method: "POST",
    data: {
      series_id: seriesId,
      raised_in_meeting_id: meetingId,
      title,
      status,
    },
  });
}

async function deleteSeries(request: APIRequestContext, seriesId: string) {
  await request.delete(
    `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${seriesId}`,
    {
      headers: serviceHeaders(),
    },
  );
}

function trackMeetingRequests(page: Page, meetingId: string) {
  const requests: Request[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/rest/v1/meetings") && url.includes(meetingId))
      requests.push(req);
  });
  const polls = () =>
    requests.filter((req) =>
      decodeURIComponent(req.url()).includes("decisions("),
    );
  const transcriptFetches = () =>
    requests.filter((req) =>
      decodeURIComponent(req.url()).includes("transcript_raw"),
    );
  return { requests, polls, transcriptFetches };
}

async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", {
      value: next,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function blockRealtime(page: Page) {
  await page.route("**/realtime/v1/**", (route) => route.abort());
  await page.routeWebSocket(/\/realtime\/v1\//, (ws) => ws.close());
}

const transcriptBox = (page: Page) =>
  page.getByPlaceholder("Paste transcript...");

async function openTranscript(page: Page) {
  const toggle = page.getByRole("button", { name: /^Transcript/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
}

test.describe("Lighter meeting polling", () => {
  test.skip(!SERVICE_KEY, "Requires service role for isolated fixtures");

  test("a live meeting shows an issue raised elsewhere within seconds, without re-downloading the transcript", async ({
    page,
    request,
  }) => {
    const seriesId = await createSeries(
      request,
      `Live polling ${randomUUID().slice(0, 6)}`,
    );
    const meetingId = await createMeeting(request, seriesId, {
      status: "live",
      transcript_raw: TRANSCRIPT,
    });
    try {
      const tracked = trackMeetingRequests(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(
        page.getByText("Polling notes stay readable").first(),
      ).toBeVisible();

      const title = `Raised elsewhere ${randomUUID().slice(0, 6)}`;
      await raiseIssue(request, seriesId, meetingId, title);
      await expect(page.getByText(title).first()).toBeVisible({
        timeout: 5_000,
      });

      await page.waitForTimeout(6_000);
      expect(tracked.polls().length).toBeGreaterThanOrEqual(3);
      // Once on open, plus at most once if the meeting row itself changes.
      expect(tracked.transcriptFetches().length).toBeLessThanOrEqual(2);
      for (const poll of tracked.polls()) {
        const response = await poll.response();
        expect(await response?.text()).not.toContain("Polling transcript body");
      }
    } finally {
      await deleteSeries(request, seriesId);
    }
  });

  test("a hidden tab makes no meeting requests and catches up when the user returns", async ({
    page,
    request,
  }) => {
    const seriesId = await createSeries(
      request,
      `Hidden polling ${randomUUID().slice(0, 6)}`,
    );
    const meetingId = await createMeeting(request, seriesId, {
      status: "live",
    });
    try {
      const tracked = trackMeetingRequests(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(
        page.getByText("Polling notes stay readable").first(),
      ).toBeVisible();

      await setVisibility(page, "hidden");
      const before = tracked.requests.length;
      const title = `Raised while away ${randomUUID().slice(0, 6)}`;
      await raiseIssue(request, seriesId, meetingId, title);
      await page.waitForTimeout(6_000);
      expect(tracked.requests.length).toBe(before);
      await expect(page.getByText(title)).toHaveCount(0);

      await setVisibility(page, "visible");
      await expect(page.getByText(title).first()).toBeVisible({
        timeout: 3_000,
      });
    } finally {
      await deleteSeries(request, seriesId);
    }
  });

  test("a live meeting that loses its network catches up on reconnect without losing issues", async ({
    page,
    context,
    request,
  }) => {
    const seriesId = await createSeries(
      request,
      `Offline polling ${randomUUID().slice(0, 6)}`,
    );
    const meetingId = await createMeeting(request, seriesId, {
      status: "live",
    });
    try {
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(
        page.getByText("Polling notes stay readable").first(),
      ).toBeVisible();

      await context.setOffline(true);
      const first = `Raised offline A ${randomUUID().slice(0, 6)}`;
      const second = `Raised offline B ${randomUUID().slice(0, 6)}`;
      await raiseIssue(request, seriesId, meetingId, first);
      await raiseIssue(request, seriesId, meetingId, second);
      await page.waitForTimeout(5_000);
      await context.setOffline(false);

      await expect(page.getByText(first).first()).toBeVisible({
        timeout: 8_000,
      });
      await expect(page.getByText(second).first()).toBeVisible();
    } finally {
      await context.setOffline(false);
      await deleteSeries(request, seriesId);
    }
  });

  test("a meeting completed elsewhere while open shows its recap, then polls slowly", async ({
    page,
    request,
  }) => {
    const seriesId = await createSeries(
      request,
      `Ending polling ${randomUUID().slice(0, 6)}`,
    );
    const meetingId = await createMeeting(request, seriesId, {
      status: "live",
    });
    try {
      const tracked = trackMeetingRequests(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(
        page.getByText("Polling notes stay readable").first(),
      ).toBeVisible();

      await rest(request, `meetings?id=eq.${meetingId}`, {
        method: "PATCH",
        data: {
          status: "completed",
          completed_at: new Date().toISOString(),
          recap_markdown:
            "## Summary\n\nThe recap landed while the page was open.",
          recap_generated_at: new Date().toISOString(),
          transcript_raw: "The recording heard the wrap-up.",
          transcription_status: "completed",
          transcription_completed_at: new Date().toISOString(),
        },
      });
      await expect(
        page.getByText("The recap landed while the page was open.").first(),
      ).toBeVisible({
        timeout: 8_000,
      });

      await page.waitForTimeout(3_000);
      const settled = tracked.polls().length;
      await page.waitForTimeout(8_000);
      expect(tracked.polls().length - settled).toBe(0);
    } finally {
      await deleteSeries(request, seriesId);
    }
  });

  test("a 3-hour transcript still shows and the page stays responsive", async ({
    page,
    request,
  }) => {
    const seriesId = await createSeries(
      request,
      `Long polling ${randomUUID().slice(0, 6)}`,
    );
    const sentence =
      "We reviewed the migration plan and agreed on next steps for the release. ";
    const longTranscript = `${sentence.repeat(2_400)}End of the three hour meeting.`;
    const meetingId = await createMeeting(request, seriesId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      transcript_raw: longTranscript,
    });
    try {
      const tracked = trackMeetingRequests(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(
        page.getByText("Polling notes stay readable").first(),
      ).toBeVisible();

      await page.getByRole("button", { name: /^Transcript/ }).click();
      const transcriptBox = page.getByPlaceholder("Paste transcript...");
      await expect(transcriptBox).toHaveValue(
        /End of the three hour meeting\.$/,
        { timeout: 5_000 },
      );

      await page.waitForTimeout(6_000);
      const started = Date.now();
      await page.getByRole("button", { name: /^Transcript/ }).click();
      await expect(transcriptBox).toBeHidden();
      expect(Date.now() - started).toBeLessThan(2_000);
      // Opening a completed meeting may write its recap once, which changes the row.
      expect(tracked.transcriptFetches().length).toBeLessThanOrEqual(2);
      for (const poll of tracked.polls()) {
        const response = await poll.response();
        expect((await response?.text())?.length ?? 0).toBeLessThan(20_000);
      }
    } finally {
      await deleteSeries(request, seriesId);
    }
  });

  test("a completed meeting stays readable and stops polling every 2 seconds", async ({
    page,
    request,
  }) => {
    const seriesId = await createSeries(
      request,
      `Done polling ${randomUUID().slice(0, 6)}`,
    );
    const meetingId = await createMeeting(request, seriesId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      transcript_raw: TRANSCRIPT,
    });
    try {
      const tracked = trackMeetingRequests(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(
        page.getByText("Polling notes stay readable").first(),
      ).toBeVisible();
      // Opening the page settles first (the first tick, a recap attempt).
      await page.waitForTimeout(3_000);
      const settled = tracked.polls().length;
      await page.waitForTimeout(10_000);
      expect(tracked.polls().length - settled).toBe(0);
    } finally {
      await deleteSeries(request, seriesId);
    }
  });

  test("a device transcript that lands while a completed meeting is open appears without a reload", async ({
    page,
    request,
  }) => {
    const seriesId = await createSeries(
      request,
      `Device polling ${randomUUID().slice(0, 6)}`,
    );
    const meetingId = await createMeeting(request, seriesId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      transcription_provider: "device",
      transcription_status: "pending",
    });
    try {
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(
        page.getByText("Polling notes stay readable").first(),
      ).toBeVisible();
      await page.waitForTimeout(1_000);

      await rest(request, `meetings?id=eq.${meetingId}`, {
        method: "PATCH",
        data: {
          transcript_raw: "The device heard the vendor migration update.",
          transcription_status: "completed",
          transcription_completed_at: new Date().toISOString(),
        },
      });

      await expect(
        page.getByText("Transcript ready. Check action items below."),
      ).toBeVisible({
        timeout: 8_000,
      });
      await page.getByRole("button", { name: /^Transcript/ }).click();
      await expect(page.getByPlaceholder("Paste transcript...")).toHaveValue(
        "The device heard the vendor migration update.",
      );
    } finally {
      await deleteSeries(request, seriesId);
    }
  });

  test("the series list counts only open issues, and resolving one lowers the count", async ({
    page,
    request,
  }) => {
    const name = `Count polling ${randomUUID().slice(0, 6)}`;
    const seriesId = await createSeries(request, name);
    const meetingId = await createMeeting(request, seriesId, {
      status: "completed",
    });
    try {
      await raiseIssue(request, seriesId, meetingId, "Open item", "open");
      await raiseIssue(
        request,
        seriesId,
        meetingId,
        "In progress item",
        "in_progress",
      );
      await raiseIssue(
        request,
        seriesId,
        meetingId,
        "Resolved item",
        "resolved",
      );
      await raiseIssue(request, seriesId, meetingId, "Dropped item", "dropped");

      await page.goto("/series");
      const card = page.locator(`a[href="/series/${seriesId}"]:has(h2)`);
      await expect(card).toContainText("2 open issues");

      await rest(
        request,
        `issues?series_id=eq.${seriesId}&title=eq.Open item`,
        {
          method: "PATCH",
          data: { status: "resolved" },
        },
      );
      await page.reload();
      await expect(card).toContainText("1 open issue");
      await expect(card).not.toContainText("1 open issues");
    } finally {
      await deleteSeries(request, seriesId);
    }
  });

  test("a series with no meetings shows its empty state from a single meetings source", async ({
    page,
    request,
  }) => {
    const seriesId = await createSeries(
      request,
      `Empty polling ${randomUUID().slice(0, 6)}`,
    );
    try {
      const meetingListRequests: string[] = [];
      page.on("request", (req) => {
        const url = decodeURIComponent(req.url());
        if (
          url.includes("/rest/v1/meetings?") &&
          url.includes(`series_id=eq.${seriesId}`)
        ) {
          meetingListRequests.push(url);
        }
      });
      await page.goto(`/series/${seriesId}`);
      await expect(page.getByText("No meetings yet.")).toBeVisible();
      expect(meetingListRequests).toHaveLength(0);
    } finally {
      await deleteSeries(request, seriesId);
    }
  });

  test.describe("with realtime unavailable, the poll alone keeps the page current", () => {
    test.beforeEach(async ({ page }) => blockRealtime(page));

    test("a companion recording that ended with no status shows its device transcript within 5s", async ({
      page,
      request,
    }) => {
      const seriesId = await createSeries(
        request,
        `Companion poll ${randomUUID().slice(0, 6)}`,
      );
      const now = new Date().toISOString();
      const meetingId = await createMeeting(request, seriesId, {
        status: "completed",
        completed_at: now,
        record_claimed_at: now,
        recording_started_at: now,
        transcription_provider: "device",
      });
      try {
        await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
        await expect(
          page.getByText("Polling notes stay readable").first(),
        ).toBeVisible();
        await page.waitForTimeout(3_000);

        await rest(request, `meetings?id=eq.${meetingId}`, {
          method: "PATCH",
          data: {
            transcript_raw: "The Mac heard the budget review.",
            transcription_status: "completed",
            transcription_completed_at: new Date().toISOString(),
          },
        });
        await expect(
          page.getByText("Transcript ready. Check action items below."),
        ).toBeVisible({
          timeout: 5_000,
        });
        await openTranscript(page);
        await expect(transcriptBox(page)).toHaveValue(
          "The Mac heard the budget review.",
        );
      } finally {
        await deleteSeries(request, seriesId);
      }
    });

    test("a device wait that failed clears as soon as the device transcript lands", async ({
      page,
      request,
    }) => {
      const seriesId = await createSeries(
        request,
        `Device wait poll ${randomUUID().slice(0, 6)}`,
      );
      const meetingId = await createMeeting(request, seriesId, {
        status: "completed",
        completed_at: new Date().toISOString(),
        transcription_provider: "device",
        transcription_status: "failed",
      });
      try {
        await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
        const waiting = page.getByText(
          "Waiting for the transcript from the recording device.",
        );
        await expect(waiting).toBeVisible();
        await page.waitForTimeout(3_000);

        await rest(request, `meetings?id=eq.${meetingId}`, {
          method: "PATCH",
          data: {
            transcript_raw: "The device finished after a retry.",
            transcription_status: "completed",
            transcription_completed_at: new Date().toISOString(),
          },
        });
        await expect(waiting).toHaveCount(0, { timeout: 5_000 });
        await openTranscript(page);
        await expect(transcriptBox(page)).toHaveValue(
          "The device finished after a retry.",
        );
      } finally {
        await deleteSeries(request, seriesId);
      }
    });

    test("a re-transcription shows the new text and never flashes an empty or failed transcript", async ({
      page,
      request,
    }) => {
      const seriesId = await createSeries(
        request,
        `Retranscribe poll ${randomUUID().slice(0, 6)}`,
      );
      const meetingId = await createMeeting(request, seriesId, {
        status: "completed",
        completed_at: new Date(Date.now() - 3_600_000).toISOString(),
        audio_file_path: "meetings/fixture/audio.webm",
        transcription_status: "processing",
        transcription_started_at: new Date().toISOString(),
      });
      try {
        await page.addInitScript(() => {
          const w = window as unknown as { __badCopy: string[] };
          w.__badCopy = [];
          const bad = [
            "No transcript is available for this recording.",
            "No recording or transcript is available for this meeting.",
            "Transcription did not finish.",
          ];
          new MutationObserver(() => {
            const text = document.body?.innerText ?? "";
            for (const copy of bad) {
              if (text.includes(copy) && !w.__badCopy.includes(copy))
                w.__badCopy.push(copy);
            }
          }).observe(document, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        });
        await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
        await expect(
          page.getByText("Polling notes stay readable").first(),
        ).toBeVisible();
        await page.waitForTimeout(4_000);
        await rest(request, `meetings?id=eq.${meetingId}`, {
          method: "PATCH",
          data: {
            transcript_raw: "The transcript after processing.",
            transcription_status: "completed",
            transcription_completed_at: new Date().toISOString(),
          },
        });
        await openTranscript(page);
        await expect(transcriptBox(page)).toHaveValue(
          "The transcript after processing.",
          {
            timeout: 5_000,
          },
        );
        await page.waitForTimeout(2_000);
        const badCopy = await page.evaluate(
          () => (window as unknown as { __badCopy: string[] }).__badCopy,
        );
        expect(badCopy).toEqual([]);
      } finally {
        await deleteSeries(request, seriesId);
      }
    });

    test("a transcript that fails to load recovers without a reload", async ({
      page,
      request,
    }) => {
      test.setTimeout(90_000);
      const seriesId = await createSeries(
        request,
        `Flaky poll ${randomUUID().slice(0, 6)}`,
      );
      const meetingId = await createMeeting(request, seriesId, {
        status: "completed",
        completed_at: new Date(Date.now() - 3_600_000).toISOString(),
        transcript_raw: "The transcript that loads after the outage.",
        transcription_status: "completed",
      });
      try {
        let failures = 0;
        await page.route(
          (url) =>
            url.pathname.endsWith("/rest/v1/meetings") &&
            url.search.includes("transcript_raw"),
          async (route) => {
            if (failures < 4) {
              failures += 1;
              await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: '{"message":"boom"}',
              });
              return;
            }
            await route.continue();
          },
        );
        await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
        await openTranscript(page);
        await expect(transcriptBox(page)).toHaveValue(
          "The transcript that loads after the outage.",
          { timeout: 45_000 },
        );
        expect(failures).toBe(4);
      } finally {
        await deleteSeries(request, seriesId);
      }
    });

    test("on a completed meeting, resolving, reopening, adding an item and a decision, and editing notes each show within 3s and survive a reload", async ({
      page,
      request,
    }) => {
      const seriesId = await createSeries(
        request,
        `Edit poll ${randomUUID().slice(0, 6)}`,
      );
      const meetingId = await createMeeting(request, seriesId, {
        status: "completed",
        completed_at: new Date(Date.now() - 3_600_000).toISOString(),
      });
      const existing = `Existing item ${randomUUID().slice(0, 6)}`;
      await raiseIssue(request, seriesId, meetingId, existing);
      try {
        await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
        const row = page
          .locator('section[aria-label="Items raised"]')
          .locator("[class*='group']")
          .filter({ hasText: existing })
          .first();
        await expect(row).toBeVisible();

        await row.getByRole("button", { name: "Mark complete" }).click();
        await expect(
          row.getByRole("button", { name: "Mark incomplete" }),
        ).toBeVisible({
          timeout: 3_000,
        });
        await expect(
          page
            .locator('section[aria-label="Resolved this meeting"]')
            .getByText(existing),
        ).toBeVisible({ timeout: 3_000 });
        await row.getByRole("button", { name: "Mark incomplete" }).click();
        await expect(
          row.getByRole("button", { name: "Mark complete" }),
        ).toBeVisible({
          timeout: 3_000,
        });

        const item = `Added after the meeting ${randomUUID().slice(0, 6)}`;
        const resolvedSection = page.locator(
          'section[aria-label="Resolved this meeting"]',
        );
        await expect(resolvedSection.getByText(existing)).toHaveCount(0, {
          timeout: 3_000,
        });

        await page.getByRole("button", { name: "Add item" }).first().click();
        await page
          .getByPlaceholder("Type item title, press Enter...")
          .fill(item);
        await page.keyboard.press("Enter");
        await expect(page.getByText(item).first()).toBeVisible({
          timeout: 3_000,
        });

        const decision = `Decided after the meeting ${randomUUID().slice(0, 6)}`;
        const addInput = page.getByPlaceholder(
          "Type item title, press Enter...",
        );
        if (!(await addInput.isVisible())) {
          await page.getByRole("button", { name: "Add item" }).first().click();
        }
        await addInput.fill(decision);
        await page
          .getByRole("button", { name: "Action", exact: true })
          .last()
          .click();
        await page
          .getByRole("button", { name: "Decision", exact: true })
          .last()
          .click();
        await page.getByPlaceholder("Type item title, press Enter...").focus();
        await page.keyboard.press("Enter");
        await expect(page.getByText(decision).first()).toBeVisible({
          timeout: 3_000,
        });

        const note = `A note written after the meeting ${randomUUID().slice(0, 6)}`;
        await page.getByRole("group", { name: "Edit notes" }).click();
        await page.getByPlaceholder("Meeting notes...").fill(note);
        await expect(page.getByPlaceholder("Meeting notes...")).toHaveValue(
          note,
          {
            timeout: 3_000,
          },
        );
        await expect
          .poll(
            async () =>
              (
                await rest(
                  request,
                  `meetings?id=eq.${meetingId}&select=notes_markdown`,
                  {
                    method: "GET",
                  },
                )
              )[0]?.notes_markdown,
            { timeout: 15_000 },
          )
          .toBe(note);

        await page.reload();
        await expect(
          row.getByRole("button", { name: "Mark complete" }),
        ).toBeVisible();
        await expect(page.getByText(item).first()).toBeVisible();
        await expect(page.getByText(decision).first()).toBeVisible();
        await expect(
          page.locator("[data-notes-rendered]").first(),
        ).toContainText(note);
      } finally {
        await deleteSeries(request, seriesId);
      }
    });

    test("an upcoming meeting's Start meeting button turns into Join live meeting when someone starts a meeting elsewhere, and back when it ends", async ({
      page,
      request,
    }) => {
      const seriesId = await createSeries(
        request,
        `Start join poll ${randomUUID().slice(0, 6)}`,
      );
      const meetingId = await createMeeting(request, seriesId, {
        status: "upcoming",
        sequence_number: 2,
      });
      try {
        await page.clock.install();
        await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
        const start = page.getByRole("button", {
          name: "Start meeting",
          exact: true,
        });
        const join = page.getByRole("button", {
          name: "Join live meeting",
          exact: true,
        });
        await expect(start).toBeVisible();
        await page.clock.runFor(3_000);
        await expect(start).toBeVisible();
        await expect(join).toHaveCount(0);

        const liveId = await createMeeting(request, seriesId, {
          status: "live",
          sequence_number: 1,
        });
        await page.clock.runFor(30_000);
        await expect(join).toBeVisible();
        await expect(start).toHaveCount(0);

        await rest(request, `meetings?id=eq.${liveId}`, {
          method: "PATCH",
          data: { status: "completed", completed_at: new Date().toISOString() },
        });
        await page.clock.runFor(30_000);
        await expect(start).toBeVisible();
        await expect(join).toHaveCount(0);
      } finally {
        await deleteSeries(request, seriesId);
      }
    });

    test("a hidden tab makes no meeting requests while a transcript is processing, and shows the transcript within 3s of returning", async ({
      page,
      request,
    }) => {
      const seriesId = await createSeries(
        request,
        `Hidden transcribe poll ${randomUUID().slice(0, 6)}`,
      );
      const meetingId = await createMeeting(request, seriesId, {
        status: "completed",
        completed_at: new Date(Date.now() - 3_600_000).toISOString(),
        audio_file_path: "meetings/fixture/audio.webm",
        transcription_status: "processing",
        transcription_started_at: new Date().toISOString(),
      });
      try {
        const tracked = trackMeetingRequests(page, meetingId);
        await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
        await expect(
          page.getByText("Polling notes stay readable").first(),
        ).toBeVisible();

        await setVisibility(page, "hidden");
        await page.waitForTimeout(1_000);
        const before = tracked.requests.length;
        await page.waitForTimeout(6_000);
        expect(tracked.requests.length).toBe(before);

        await rest(request, `meetings?id=eq.${meetingId}`, {
          method: "PATCH",
          data: {
            transcript_raw: "The transcript that finished while away.",
            transcription_status: "completed",
            transcription_completed_at: new Date().toISOString(),
          },
        });
        await setVisibility(page, "visible");
        await expect(
          page.getByRole("button", { name: /^Transcript/ }),
        ).toBeVisible({ timeout: 3_000 });
        await openTranscript(page);
        await expect(transcriptBox(page)).toHaveValue(
          "The transcript that finished while away.",
        );
      } finally {
        await deleteSeries(request, seriesId);
      }
    });
  });
});
