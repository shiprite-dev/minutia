import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Route,
} from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_AI = !!(process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY);
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

const STORED_RECAP =
  "The team agreed to ship the rollout on Friday. **Test User** drafts the rollout plan and Mike Ross books the vendor review.";
const ME_THEM_TRANSCRIPT =
  "Test User: I will draft the rollout plan.\nThem: Then I will book the vendor review.";
const ME_THEM_SEGMENTS = [
  {
    speaker: "me",
    start: 0,
    end: 3,
    text: "I will draft the rollout plan.",
    confidence: 0.93,
  },
  {
    speaker: "them",
    start: 3,
    end: 6,
    text: "Then I will book the vendor review.",
    confidence: 0.91,
  },
];

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
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

interface MeetingSeed {
  notes_markdown?: string;
  companion_notes_markdown?: string;
  transcript_raw?: string | null;
  transcript_diarized?: boolean;
  transcript_segments?: unknown[] | null;
  speaker_map?: Record<string, string | null> | null;
  recap_markdown?: string | null;
  recap_generated_at?: string | null;
  recap_model?: string | null;
  transcription_status?: string | null;
  transcription_started_at?: string | null;
  audio_file_path?: string | null;
}

interface SuggestionSeed {
  title: string;
  owner_name?: string;
  source_excerpt?: string;
}

interface Fixture {
  seriesId: string;
  meetingId: string;
  url: string;
}

async function createFixture(
  request: APIRequestContext,
  meeting: MeetingSeed = {},
  suggestions: SuggestionSeed[] = [],
): Promise<Fixture> {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();

  await rest(request, "meeting_series", {
    method: "POST",
    headers: serviceHeaders("return=minimal"),
    data: {
      id: seriesId,
      name: `Recap page coverage ${stamp}`,
      description: "Created by recap page functional coverage.",
      cadence: "weekly",
      default_attendees: ["Test User", "Mike Ross"],
      owner_id: TEST_USER_ID,
    },
  });
  await rest(request, "meetings", {
    method: "POST",
    headers: serviceHeaders("return=minimal"),
    data: {
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: `Recap session ${stamp}`,
      date: "2026-11-15",
      attendees: ["Test User", "Mike Ross"],
      status: "completed",
      completed_at: new Date().toISOString(),
      notes_markdown: "",
      companion_notes_markdown: "",
      transcript_raw: null,
      ...meeting,
    },
  });
  if (suggestions.length > 0) {
    await rest(request, "meeting_ai_suggestions", {
      method: "POST",
      headers: serviceHeaders("return=minimal"),
      data: suggestions.map((s) => ({
        meeting_id: meetingId,
        series_id: seriesId,
        type: "new_item",
        category: "action",
        title: s.title,
        owner_name: s.owner_name ?? "",
        confidence: 0.9,
        source_excerpt: s.source_excerpt ?? "",
        status: "pending",
      })),
    });
  }

  return {
    seriesId,
    meetingId,
    url: `/series/${seriesId}/meetings/${meetingId}`,
  };
}

async function deleteFixture(request: APIRequestContext, fixture: Fixture) {
  await rest(request, `meeting_series?id=eq.${fixture.seriesId}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

async function readMeeting(
  request: APIRequestContext,
  meetingId: string,
  select: string,
) {
  const rows = (await rest(
    request,
    `meetings?id=eq.${meetingId}&select=${select}`,
  )) as Record<string, unknown>[];
  return rows[0];
}

function sseResponse(words: string[], model = "test-model-x") {
  const frames = words
    .map((w) => `data: ${JSON.stringify({ t: w })}\n\n`)
    .join("");
  return {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-summary-model": model,
    },
    body: `:\n\n${frames}data: [DONE]\n\n`,
  };
}

// Counts every recap stream request for the meeting (with or without a query
// string, so a regenerate is caught too) and answers with a fixed recap, so no
// test depends on a live AI provider.
async function countRecapStreams(
  page: Page,
  meetingId: string,
  respond: (route: Route, call: number) => Promise<void> = (route) =>
    route.fulfill(
      sseResponse(["Fresh ", "recap ", "from ", "the ", "stream."]),
    ),
) {
  const counter = { calls: 0 };
  const path = `/api/meetings/${meetingId}/summary/stream`;
  await page.route(
    (url) => url.pathname === path,
    (route) => {
      counter.calls += 1;
      return respond(route, counter.calls);
    },
  );
  return counter;
}

async function open(page: Page, fixture: Fixture) {
  await page.goto(fixture.url);
  await waitForApp(page);
  await expect(page.getByText("Meeting recap", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

async function topOf(page: Page, locator: ReturnType<Page["locator"]>) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no layout box");
  return box.y;
}

async function boxOf(locator: ReturnType<Page["locator"]>) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no layout box");
  return box;
}

const LONG_NOTES = Array.from(
  { length: 80 },
  (_, i) => `Note line ${i + 1}: rollout detail recorded in the room.`,
).join("\n\n");

function layoutFixture(request: APIRequestContext) {
  return createFixture(
    request,
    {
      notes_markdown: LONG_NOTES,
      transcript_raw: ME_THEM_TRANSCRIPT,
      transcript_diarized: true,
      transcript_segments: ME_THEM_SEGMENTS,
      speaker_map: { me: "Test User", them: null },
      recap_markdown: STORED_RECAP,
      recap_generated_at: new Date().toISOString(),
      recap_model: "test-model-x",
    },
    [
      {
        title: "Draft the rollout plan",
        owner_name: "Test User",
        source_excerpt: "I will draft the rollout plan.",
      },
      {
        title: "Book the vendor review",
        owner_name: "Mike Ross",
        source_excerpt: "Then I will book the vendor review.",
      },
    ],
  );
}

function layoutParts(page: Page) {
  return {
    recap: page.locator("[data-recap-section]"),
    rail: page.locator('section[aria-label="Tracked in the log"]'),
    notes: page.getByRole("heading", { name: "Notes", exact: true }),
  };
}

async function startWithCalendarClosed(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("minutia:calendar-sidebar", "false");
    } catch {}
  });
}

test.describe("Completed meeting recap page", () => {
  test.skip(
    !HAS_SERVICE_ROLE,
    "Requires service role for isolated recap fixtures",
  );

  test("facilitator opens an unreviewed meeting, approves the work, and the next step lights up", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(
      request,
      {
        transcript_raw: ME_THEM_TRANSCRIPT,
        transcript_diarized: true,
        transcript_segments: ME_THEM_SEGMENTS,
        speaker_map: { me: "Test User", them: null },
        recap_markdown: STORED_RECAP,
        recap_generated_at: new Date(Date.now() - 2 * 60_000).toISOString(),
        recap_model: "test-model-x",
      },
      [
        {
          title: "Draft the rollout plan",
          owner_name: "Test User",
          source_excerpt: "I will draft the rollout plan.",
        },
        {
          title: "Book the vendor review",
          owner_name: "Mike Ross",
          source_excerpt: "Then I will book the vendor review.",
        },
      ],
    );

    try {
      const streams = await countRecapStreams(page, fixture.meetingId);
      await open(page, fixture);

      await expect(page.locator("[data-flowing-summary]")).toContainText(
        "The team agreed to ship the rollout on Friday.",
      );
      await expect(
        page.getByRole("button", { name: /generate recap/i }),
      ).toHaveCount(0);

      const region = page.getByRole("region", { name: "AI suggestions" });
      await expect(region).toBeVisible();
      await expect(page.getByText("To review", { exact: true })).toBeVisible();
      await expect(region.locator("[data-suggestion-card]")).toHaveCount(2);
      await expect(
        page.getByRole("button", {
          name: /Review AI suggestions|Review action items/,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "AI accountability review" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Send notes" }),
      ).toHaveAttribute("data-emphasis", "outline");

      const accept = region
        .locator("[data-suggestion-card]")
        .filter({ hasText: "I will draft the rollout plan." });
      await accept.getByRole("button", { name: "Accept suggestion" }).click();
      const reject = region
        .locator("[data-suggestion-card]")
        .filter({ hasText: "Then I will book the vendor review." });
      await reject.getByRole("button", { name: "Reject suggestion" }).click();

      await expect(
        page.getByText(/Review complete\. 1 added to the log, 1 dismissed\./),
      ).toBeVisible();
      await expect(
        page.locator('section[aria-label="Items raised"]'),
      ).toContainText("Draft the rollout plan");
      await expect(
        page.getByRole("button", { name: "Send notes" }),
      ).toHaveAttribute("data-emphasis", "accent");

      const reviewed = (await rest(
        request,
        `meeting_ai_suggestions?meeting_id=eq.${fixture.meetingId}&select=title,status&order=title`,
      )) as { title: string; status: string }[];
      expect(reviewed).toEqual([
        { title: "Book the vendor review", status: "rejected" },
        { title: "Draft the rollout plan", status: "accepted" },
      ]);
      const issues = (await rest(
        request,
        `issues?raised_in_meeting_id=eq.${fixture.meetingId}&select=title`,
      )) as { title: string }[];
      expect(issues.map((i) => i.title)).toContain("Draft the rollout plan");

      // The review result survives a reload.
      await page.reload();
      await waitForApp(page);
      await expect(
        page.getByText(/Review complete\. 1 added to the log, 1 dismissed\./),
      ).toBeVisible({ timeout: 20_000 });
      expect(streams.calls).toBe(0);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("reader meets the recap, then the log, then the notes, then the transcript", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {
      notes_markdown: "Rollout owners confirmed in the room.",
      transcript_raw: "Test User: Ship the rollout on Friday.",
      recap_markdown: STORED_RECAP,
      recap_generated_at: new Date().toISOString(),
      recap_model: "test-model-x",
    });

    try {
      await page.setViewportSize({ width: 800, height: 900 });
      await countRecapStreams(page, fixture.meetingId);
      await open(page, fixture);

      const recapY = await topOf(page, page.locator("[data-recap-section]"));
      const logY = await topOf(
        page,
        page.getByRole("heading", { name: "Tracked in the log" }),
      );
      const notesY = await topOf(
        page,
        page.getByRole("heading", { name: "Notes", exact: true }),
      );
      const transcriptY = await topOf(
        page,
        page.getByRole("button", { name: /^Transcript/ }),
      );
      expect(recapY).toBeLessThan(logY);
      expect(logY).toBeLessThan(notesY);
      expect(notesY).toBeLessThan(transcriptY);

      await expect(
        page.locator("#main-content").getByText(/^0[1-9]$/),
      ).toHaveCount(0);
      await expect(page.locator("footer").getByText(/Replay/)).toHaveCount(0);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("on a wide screen the facilitator reviews the queue beside the recap", async ({
    page,
    request,
  }) => {
    const fixture = await layoutFixture(request);

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await startWithCalendarClosed(page);
      await countRecapStreams(page, fixture.meetingId);
      await open(page, fixture);
      await expect(page.locator("[data-flowing-summary]")).toContainText(
        "The team agreed to ship the rollout on Friday.",
      );

      const toReview = page.getByText("To review", { exact: true });
      const region = page.getByRole("region", { name: "AI suggestions" });
      await expect(toReview).toBeInViewport();
      await expect(region).toBeInViewport();

      const parts = layoutParts(page);
      const recap = await boxOf(parts.recap);
      const rail = await boxOf(parts.rail);
      expect(rail.x).toBeGreaterThanOrEqual(recap.x + recap.width);
      expect(Math.abs(rail.y - recap.y)).toBeLessThanOrEqual(2);

      const prose = await boxOf(page.locator("[data-flowing-summary]"));
      expect(prose.width).toBeGreaterThanOrEqual(480);
      expect(prose.width).toBeLessThanOrEqual(720);

      const notes = await boxOf(parts.notes);
      expect(Math.abs(notes.x - recap.x)).toBeLessThanOrEqual(2);
      expect(notes.y).toBeGreaterThan(recap.y);

      const send = page.getByRole("button", { name: "Send notes" });
      await expect(send).toHaveAttribute("data-emphasis", "outline");

      const main = page.locator("#main-content");
      expect(
        await main.evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(true);
      await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect
        .poll(() => main.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      await expect(toReview).toBeInViewport();

      await region
        .locator("[data-suggestion-card]")
        .filter({ hasText: "I will draft the rollout plan." })
        .getByRole("button", { name: "Accept suggestion" })
        .click();
      await region
        .locator("[data-suggestion-card]")
        .filter({ hasText: "Then I will book the vendor review." })
        .getByRole("button", { name: "Reject suggestion" })
        .click();

      await expect(
        page
          .locator('section[aria-label="Items raised"]')
          .getByText("Draft the rollout plan")
          .first(),
      ).toBeInViewport();
      await expect(
        page.getByText(/Review complete\. 1 added to the log, 1 dismissed\./),
      ).toBeVisible();
      await expect(send).toHaveAttribute("data-emphasis", "accent");

      await expect
        .poll(async () => {
          const rows = (await rest(
            request,
            `meeting_ai_suggestions?meeting_id=eq.${fixture.meetingId}&select=title,status&order=title`,
          )) as { title: string; status: string }[];
          return rows;
        })
        .toEqual([
          { title: "Book the vendor review", status: "rejected" },
          { title: "Draft the rollout plan", status: "accepted" },
        ]);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("on a narrow window the page is one column in reading order", async ({
    page,
    request,
  }) => {
    const fixture = await layoutFixture(request);

    try {
      await page.setViewportSize({ width: 800, height: 900 });
      await countRecapStreams(page, fixture.meetingId);
      await open(page, fixture);

      const parts = layoutParts(page);
      const recap = await boxOf(parts.recap);
      const rail = await boxOf(parts.rail);
      expect(rail.y).toBeGreaterThan(recap.y + recap.height - 1);
      expect(Math.abs(rail.x - recap.x)).toBeLessThanOrEqual(2);
      const notes = await boxOf(parts.notes);
      expect(notes.y).toBeGreaterThan(rail.y);

      const overflow = await page.evaluate(() => {
        const main = document.getElementById("main-content");
        return {
          doc:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          main: main ? main.scrollWidth - main.clientWidth : 0,
        };
      });
      expect(overflow.doc).toBeLessThanOrEqual(0);
      expect(overflow.main).toBeLessThanOrEqual(0);

      const card = page
        .getByRole("region", { name: "AI suggestions" })
        .locator("[data-suggestion-card]")
        .first();
      await expect(card.getByLabel("Suggestion title")).toBeVisible();
      await expect(card.getByLabel("Suggestion owner")).toBeVisible();
      await expect(card.getByLabel("Suggestion due date")).toBeVisible();
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("opening the calendar panel folds the rail under the recap and closing it restores it", async ({
    page,
    request,
  }) => {
    const fixture = await layoutFixture(request);

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await startWithCalendarClosed(page);
      await countRecapStreams(page, fixture.meetingId);
      await open(page, fixture);

      const parts = layoutParts(page);
      const beside = async () => {
        const recap = await boxOf(parts.recap);
        const rail = await boxOf(parts.rail);
        return (
          rail.x >= recap.x + recap.width && Math.abs(rail.y - recap.y) <= 2
        );
      };
      const below = async () => {
        const recap = await boxOf(parts.recap);
        const rail = await boxOf(parts.rail);
        return rail.y > recap.y + recap.height - 1;
      };
      expect(await beside()).toBe(true);

      await page.getByRole("button", { name: "Open calendar" }).click();
      await expect(
        page.getByRole("complementary", { name: "Calendar sidebar" }),
      ).toBeVisible();
      await expect.poll(below).toBe(true);

      await page.getByRole("button", { name: "Close calendar" }).click();
      await expect(
        page.getByRole("complementary", { name: "Calendar sidebar" }),
      ).toHaveCount(0);
      await expect.poll(beside).toBe(true);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("returning to a recapped meeting shows the stored recap and never generates again", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {
      transcript_raw: "Test User: Ship the rollout on Friday.",
      recap_markdown: STORED_RECAP,
      recap_generated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      recap_model: "test-model-x",
    });

    try {
      const streams = await countRecapStreams(page, fixture.meetingId);
      for (let visit = 0; visit < 3; visit += 1) {
        if (visit === 0) await open(page, fixture);
        else {
          await page.reload();
          await waitForApp(page);
        }
        await expect(page.locator("[data-flowing-summary]")).toContainText(
          "The team agreed to ship the rollout on Friday.",
          { timeout: 20_000 },
        );
        const provenance = page.locator("[data-recap-provenance]");
        await expect(provenance).toContainText("Written by AI");
        await expect(provenance).toContainText("5 min ago");
        await expect(provenance).toHaveAttribute("title", "test-model-x");
      }
      expect(streams.calls).toBe(0);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("first visit after a meeting writes the recap without a click", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {
      transcript_raw: "Test User: Ship the rollout on Friday.",
    });

    try {
      const streams = await countRecapStreams(
        page,
        fixture.meetingId,
        async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await route.fulfill(
            sseResponse(["The ", "rollout ", "ships ", "Friday."]),
          );
        },
      );
      await open(page, fixture);

      const progress = page.getByRole("status", { name: "Recap progress" });
      await expect(progress).toContainText("Writing recap");
      await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

      await expect(page.locator("[data-flowing-summary]")).toContainText(
        "The rollout ships Friday.",
      );
      await expect(page.locator("[data-recap-provenance]")).toContainText(
        "Written by AI",
      );
      await expect(progress).toHaveCount(0);
      await expect(
        page
          .locator("span[aria-live='polite']")
          .filter({ hasText: "Summary ready" }),
      ).toHaveCount(1);
      expect(streams.calls).toBe(1);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("a recap that fails to write offers one retry that recovers", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {
      transcript_raw: "Test User: Ship the rollout on Friday.",
    });

    try {
      // Fail until the user retries: a dev-mode remount can send an aborted
      // first request, so the call count cannot decide which answer fails.
      let retried = false;
      const streams = await countRecapStreams(page, fixture.meetingId, (route) =>
        retried
          ? route.fulfill(sseResponse(["Recovered ", "recap."]))
          : route.fulfill({
              status: 500,
              contentType: "application/json",
              body: "{}",
            }),
      );
      await open(page, fixture);

      await expect(
        page.getByText("The recap could not be written."),
      ).toBeVisible();
      const callsBeforeRetry = streams.calls;
      retried = true;
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.locator("[data-flowing-summary]")).toContainText(
        "Recovered recap.",
      );
      await expect(
        page.getByText("The recap could not be written."),
      ).toHaveCount(0);
      expect(streams.calls).toBe(callsBeforeRetry + 1);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  for (const [name, body] of [
    [
      "a provider failure before the first word",
      `:\n\ndata: {"m":"test-model-x"}\n\ndata: {"e":"failed"}\n\ndata: [DONE]\n\n`,
    ],
    ["a stream that ends with no words", `:\n\ndata: [DONE]\n\n`],
  ] as const) {
    test(`${name} offers a retry instead of an empty recap, and the retry recovers`, async ({
      page,
      request,
    }) => {
      const fixture = await createFixture(request, {
        transcript_raw: "Test User: Ship the rollout on Friday.",
      });

      try {
        const urls: string[] = [];
        let retried = false;
        const streams = await countRecapStreams(
          page,
          fixture.meetingId,
          (route) => {
            urls.push(route.request().url());
            return !retried
              ? route.fulfill({
                  status: 200,
                  headers: {
                    "content-type": "text/event-stream",
                    "x-summary-model": "test-model-x",
                  },
                  body,
                })
              : route.fulfill(sseResponse(["Recovered ", "recap."]));
          },
        );
        await open(page, fixture);

        await expect(
          page.getByText("The recap could not be written."),
        ).toBeVisible();
        await expect(page.locator("[data-recap-provenance]")).toHaveCount(0);
        await expect(
          page
            .locator("span[aria-live='polite']")
            .filter({ hasText: "Summary ready" }),
        ).toHaveCount(0);

        const callsBeforeRetry = streams.calls;
        retried = true;
        await page.getByRole("button", { name: "Try again" }).click();
        await expect(page.locator("[data-flowing-summary]")).toContainText(
          "Recovered recap.",
        );
        await expect(page.locator("[data-recap-provenance]")).toContainText(
          "Written by AI",
        );
        await expect(
          page.getByText("The recap could not be written."),
        ).toHaveCount(0);
        expect(streams.calls).toBe(callsBeforeRetry + 1);
        expect(urls.every((u) => !u.includes("regenerate=1"))).toBe(true);
      } finally {
        await deleteFixture(request, fixture);
      }
    });
  }

  test("a transcribing meeting says what is happening instead of showing empty sections", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {
      audio_file_path: `${randomUUID()}/recording.webm`,
      transcription_status: "processing",
      transcription_started_at: new Date().toISOString(),
    });

    try {
      const streams = await countRecapStreams(page, fixture.meetingId);
      await open(page, fixture);

      const progress = page.getByRole("status", { name: "Recap progress" });
      await expect(progress).toContainText("Transcribing");
      await expect(progress).toContainText("Finding action items");
      await expect(progress).toContainText("Writing recap");
      await expect(progress).toContainText(/Started \d+ minutes ago/);
      await expect(progress.getByRole("button")).toHaveCount(0);

      await expect(
        page.getByRole("region", { name: "Transcription status" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Review action items" }),
      ).toHaveCount(0);
      await expect(
        page.locator("[data-recap-section] [data-slot='skeleton']"),
      ).toHaveCount(3);
      await expect(
        page.getByRole("button", { name: /^Transcript/ }),
      ).toHaveCount(0);
      expect(streams.calls).toBe(0);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("a meeting with no audio and no notes stays quiet and leads to the notes", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {});

    try {
      await page.route(
        `**/api/meetings/${fixture.meetingId}/summary/stream`,
        (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "AI recap is not configured." }),
          }),
      );
      await open(page, fixture);

      await expect(
        page.getByText(
          "No recording or transcript is available for this meeting.",
        ),
      ).toBeVisible();
      await expect(page.locator("[data-recap-section]")).toHaveCount(0);
      await expect(page.getByText("To review", { exact: true })).toHaveCount(0);
      await expect(
        page.getByText("Items raised", { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("No items raised yet")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Add item" }).first(),
      ).toBeVisible();

      await page
        .getByRole("button", { name: "Add notes", exact: true })
        .click();
      const notes = page.getByPlaceholder("Meeting notes...");
      await expect(notes).toBeFocused();
      await notes.fill("Agreed to revisit the rollout next week.");

      await expect
        .poll(
          async () =>
            (await readMeeting(request, fixture.meetingId, "notes_markdown"))
              .notes_markdown,
          { timeout: 10_000 },
        )
        .toBe("Agreed to revisit the rollout next week.");
      // Notes now exist, so there is nothing left to explain; a provider that is
      // not configured keeps the recap section absent rather than broken.
      await expect(
        page.getByText(
          "No recording or transcript is available for this meeting.",
        ),
      ).toHaveCount(0);
      await expect(page.locator("[data-recap-section]")).toHaveCount(0);
      await expect(
        page.getByText("The recap could not be written."),
      ).toHaveCount(0);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("desktop notes lead the notes when nothing was typed on the web", async ({
    page,
    request,
  }) => {
    const companion = "Desk note: vendor review moves to Thursday.";
    const fixture = await createFixture(request, {
      companion_notes_markdown: companion,
    });

    try {
      await page.route(
        `**/api/meetings/${fixture.meetingId}/summary/stream`,
        (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: "{}",
          }),
      );
      await open(page, fixture);

      await expect(
        page.getByRole("heading", { name: "Notes", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(companion)).toBeVisible();
      const desktopHeading = page.getByRole("heading", {
        name: "From your desktop notepad",
      });
      const textarea = page.getByPlaceholder("Meeting notes...");
      await expect(desktopHeading).toBeVisible();
      await expect(textarea).toBeVisible();
      const headingFirst = await desktopHeading.evaluate((heading) => {
        const area = document.querySelector(
          'textarea[placeholder="Meeting notes..."]',
        );
        return (
          !!area &&
          !!(
            heading.compareDocumentPosition(area) &
            Node.DOCUMENT_POSITION_FOLLOWING
          )
        );
      });
      expect(headingFirst).toBe(true);

      await textarea.fill("Web follow-up: confirm the venue.");
      await expect
        .poll(
          async () =>
            readMeeting(
              request,
              fixture.meetingId,
              "notes_markdown,companion_notes_markdown",
            ),
          { timeout: 10_000 },
        )
        .toEqual({
          notes_markdown: "Web follow-up: confirm the venue.",
          companion_notes_markdown: companion,
        });
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("header carries one action and a menu that regenerates and shares", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {
      transcript_raw: "Test User: Ship the rollout on Friday.",
      recap_markdown: STORED_RECAP,
      recap_generated_at: new Date().toISOString(),
      recap_model: "test-model-x",
    });

    try {
      const regenerateUrls: string[] = [];
      const streams = await countRecapStreams(
        page,
        fixture.meetingId,
        (route) => {
          regenerateUrls.push(route.request().url());
          return route.fulfill(
            sseResponse(["Regenerated ", "recap ", "text."]),
          );
        },
      );
      await open(page, fixture);

      await expect(
        page.getByRole("button", { name: "Send notes" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Remind owners" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /share link/i }),
      ).toHaveCount(0);

      await page.getByRole("button", { name: "More actions" }).click();
      await expect(
        page.getByRole("menuitem", { name: "Remind owners" }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Copy share link" }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Find action items again" }),
      ).toHaveCount(0);
      await page.getByRole("menuitem", { name: "Regenerate recap" }).click();

      await expect(page.locator("[data-flowing-summary]")).toContainText(
        "Regenerated recap text.",
      );
      expect(streams.calls).toBe(1);
      expect(regenerateUrls[0]).toContain("regenerate=1");

      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Copy share link" }).click();
      await expect(page.getByText("Link copied")).toBeVisible();
      await expect
        .poll(async () => {
          const rows = (await rest(
            request,
            `guest_shares?resource_type=eq.meeting&resource_id=eq.${fixture.meetingId}&select=id`,
          )) as unknown[];
          return rows.length;
        })
        .toBeGreaterThan(0);
    } finally {
      await rest(request, `guest_shares?resource_id=eq.${fixture.meetingId}`, {
        method: "DELETE",
        headers: serviceHeaders("return=minimal"),
      });
      await deleteFixture(request, fixture);
    }
  });

  test("pressing R on a recapped meeting does not re-run the recap", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {
      transcript_raw: "Test User: Ship the rollout on Friday.",
      recap_markdown: STORED_RECAP,
      recap_generated_at: new Date().toISOString(),
      recap_model: "test-model-x",
    });

    try {
      const streams = await countRecapStreams(page, fixture.meetingId);
      await open(page, fixture);
      await expect(page.locator("[data-flowing-summary]")).toContainText(
        "The team agreed to ship the rollout on Friday.",
      );

      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("r");
      await page.waitForTimeout(800);

      expect(streams.calls).toBe(0);
      await expect(
        page.getByRole("button", { name: "Replay recap" }),
      ).toHaveCount(0);
      await expect(page.locator("[data-flowing-summary]")).toContainText(
        "The team agreed to ship the rollout on Friday.",
      );
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("the transcript stays collapsed as evidence until it is opened", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {
      transcript_raw: ME_THEM_TRANSCRIPT,
      transcript_diarized: true,
      transcript_segments: ME_THEM_SEGMENTS,
      speaker_map: { me: "Test User", them: null },
      recap_markdown: STORED_RECAP,
      recap_generated_at: new Date().toISOString(),
      recap_model: "test-model-x",
    });

    try {
      await countRecapStreams(page, fixture.meetingId);
      await open(page, fixture);

      const toggle = page.getByRole("button", { name: /^Transcript/ });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toContainText("Me / Them · 2 speakers");
      await expect(
        page.getByRole("button", { name: /^Rename Me,/ }),
      ).toHaveCount(0);

      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(
        page
          .getByRole("button", { name: "Rename Me, currently Test User" })
          .first(),
      ).toBeVisible();
      await expect(
        page.getByText("Then I will book the vendor review."),
      ).toBeVisible();
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("a participant reads the record without the facilitator tools", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(
      request,
      {
        notes_markdown: "Participant-visible note.",
        transcript_raw: "Test User: Ship the rollout on Friday.",
        recap_markdown: STORED_RECAP,
        recap_generated_at: new Date().toISOString(),
        recap_model: "test-model-x",
      },
      [{ title: "Draft the rollout plan", owner_name: "Test User" }],
    );

    try {
      await rest(
        request,
        `series_participants?series_id=eq.${fixture.seriesId}&user_id=eq.${TEST_USER_ID}`,
        {
          method: "PATCH",
          headers: serviceHeaders("return=minimal"),
          data: { role: "participant" },
        },
      );
      const streams = await countRecapStreams(page, fixture.meetingId);
      await open(page, fixture);

      await expect(page.locator("[data-flowing-summary]")).toContainText(
        "The team agreed to ship the rollout on Friday.",
      );
      await expect(page.getByText("To review", { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "AI suggestions" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Enhance notes" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("status", { name: "Recap progress" }),
      ).toHaveCount(0);
      await expect(page.getByPlaceholder("Meeting notes...")).toHaveJSProperty(
        "readOnly",
        true,
      );

      await page.getByRole("button", { name: "More actions" }).click();
      await expect(
        page.getByRole("menuitem", { name: "Copy share link" }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Regenerate recap" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("menuitem", { name: "Remind owners" }),
      ).toHaveCount(0);
      expect(streams.calls).toBe(0);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("a participant on a meeting with no recap never starts one", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {
      notes_markdown: "Participant-visible note.",
      transcript_raw: "Test User: Ship the rollout on Friday.",
    });

    try {
      await rest(
        request,
        `series_participants?series_id=eq.${fixture.seriesId}&user_id=eq.${TEST_USER_ID}`,
        {
          method: "PATCH",
          headers: serviceHeaders("return=minimal"),
          data: { role: "participant" },
        },
      );
      const streams = await countRecapStreams(page, fixture.meetingId);
      await open(page, fixture);

      await expect(page.getByPlaceholder("Meeting notes...")).toHaveJSProperty(
        "readOnly",
        true,
      );
      await expect(page.locator("[data-recap-section]")).toHaveCount(0);
      await expect(
        page.getByRole("status", { name: "Recap progress" }),
      ).toHaveCount(0);
      await page.waitForTimeout(1500);
      expect(streams.calls).toBe(0);
      const row = await readMeeting(request, fixture.meetingId, "recap_markdown");
      expect(row.recap_markdown).toBeNull();
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("failed action-item extraction shows one retry in the log that recovers", async ({
    page,
    request,
  }) => {
    const fixture = await createFixture(request, {
      audio_file_path: `${randomUUID()}/recording.webm`,
      transcription_status: "failed",
    });

    try {
      await page.route(
        `**/api/meetings/${fixture.meetingId}/transcribe`,
        (route) =>
          route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Action items failed.",
              code: "extraction_failed",
            }),
          }),
      );
      await page.route(
        `**/api/meetings/${fixture.meetingId}/suggestions`,
        (route) =>
          route.request().method() === "POST"
            ? route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                  suggestions: [
                    {
                      id: randomUUID(),
                      meeting_id: fixture.meetingId,
                      series_id: fixture.seriesId,
                      type: "new_item",
                      category: "action",
                      title: "Recovered action item",
                      details: "",
                      owner_name: "",
                      due_date: null,
                      confidence: 0.8,
                      source_excerpt: "",
                      related_issue_number: null,
                      suggested_status: null,
                      status: "pending",
                      created_at: new Date().toISOString(),
                      reviewed_at: null,
                    },
                  ],
                }),
              })
            : route.fulfill({
                status: 200,
                contentType: "application/json",
                body: '{"suggestions":[]}',
              }),
      );
      await open(page, fixture);

      await page
        .getByRole("region", { name: "Transcription status" })
        .getByRole("button", { name: "Retry transcription", exact: true })
        .click();

      await expect(
        page.getByText("Action items could not be created."),
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Retry action items" }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("region", { name: "Transcription status" }),
      ).toHaveCount(0);

      await page.getByRole("button", { name: "Retry action items" }).click();
      const region = page.getByRole("region", { name: "AI suggestions" });
      await expect(region.getByLabel("Suggestion title")).toHaveValue(
        "Recovered action item",
      );
      await expect(
        page.getByText("Action items could not be created."),
      ).toHaveCount(0);
    } finally {
      await deleteFixture(request, fixture);
    }
  });

  test("a live recap is stored and served on the next visit (live provider only)", async ({
    page,
    request,
  }) => {
    test.skip(
      !HAS_AI,
      "Needs a live AI provider; CI covers persistence in scripts/verify-recap.test.mjs",
    );
    test.setTimeout(90_000);
    const fixture = await createFixture(request, {
      transcript_raw:
        "Test User: Ship the rollout on Friday. Mike Ross: I will book the vendor review.",
    });

    try {
      const requests: string[] = [];
      page.on("request", (r) => {
        if (
          r.url().includes(`/api/meetings/${fixture.meetingId}/summary/stream`)
        )
          requests.push(r.url());
      });
      await open(page, fixture);
      await expect(page.locator("[data-recap-provenance]")).toContainText(
        "Written by AI",
        {
          timeout: 60_000,
        },
      );
      expect(requests).toHaveLength(1);

      const stored = await readMeeting(
        request,
        fixture.meetingId,
        "recap_markdown,recap_generated_at,recap_model",
      );
      expect(String(stored.recap_markdown ?? "").trim().length).toBeGreaterThan(
        0,
      );
      expect(stored.recap_generated_at).toBeTruthy();
      expect(stored.recap_model).toBeTruthy();

      await page.reload();
      await waitForApp(page);
      await expect(page.locator("[data-recap-provenance]")).toContainText(
        "Written by AI",
        {
          timeout: 20_000,
        },
      );
      expect(requests).toHaveLength(1);
    } finally {
      await deleteFixture(request, fixture);
    }
  });
});
