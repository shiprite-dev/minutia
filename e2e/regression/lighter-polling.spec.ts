import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type Page, type Request } from "@playwright/test";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
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
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
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
    { method: "GET" }
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
    data: { series_id: id, user_id: TEST_USER_ID, role: "owner", invited_by: TEST_USER_ID },
    headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
  });
  return id;
}

async function createMeeting(
  request: APIRequestContext,
  seriesId: string,
  fields: Record<string, unknown>
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
  status = "open"
) {
  await rest(request, "issues", {
    method: "POST",
    data: { series_id: seriesId, raised_in_meeting_id: meetingId, title, status },
  });
}

async function deleteSeries(request: APIRequestContext, seriesId: string) {
  await request.delete(`${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${seriesId}`, {
    headers: serviceHeaders(),
  });
}

function trackMeetingRequests(page: Page, meetingId: string) {
  const requests: Request[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/rest/v1/meetings") && url.includes(meetingId)) requests.push(req);
  });
  const polls = () =>
    requests.filter((req) => decodeURIComponent(req.url()).includes("decisions("));
  const transcriptFetches = () =>
    requests.filter((req) => decodeURIComponent(req.url()).includes("transcript_raw"));
  return { requests, polls, transcriptFetches };
}

async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { value: next, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test.describe("Lighter meeting polling", () => {
  test.skip(!SERVICE_KEY, "Requires service role for isolated fixtures");

  test("a live meeting shows an issue raised elsewhere within seconds, without re-downloading the transcript", async ({
    page,
    request,
  }) => {
    const seriesId = await createSeries(request, `Live polling ${randomUUID().slice(0, 6)}`);
    const meetingId = await createMeeting(request, seriesId, {
      status: "live",
      transcript_raw: TRANSCRIPT,
    });
    try {
      const tracked = trackMeetingRequests(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(page.getByText("Polling notes stay readable").first()).toBeVisible();

      const title = `Raised elsewhere ${randomUUID().slice(0, 6)}`;
      await raiseIssue(request, seriesId, meetingId, title);
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 5_000 });

      await page.waitForTimeout(6_000);
      expect(tracked.polls().length).toBeGreaterThanOrEqual(3);
      expect(tracked.transcriptFetches().length).toBe(1);
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
    const seriesId = await createSeries(request, `Hidden polling ${randomUUID().slice(0, 6)}`);
    const meetingId = await createMeeting(request, seriesId, { status: "live" });
    try {
      const tracked = trackMeetingRequests(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(page.getByText("Polling notes stay readable").first()).toBeVisible();

      await setVisibility(page, "hidden");
      const before = tracked.requests.length;
      const title = `Raised while away ${randomUUID().slice(0, 6)}`;
      await raiseIssue(request, seriesId, meetingId, title);
      await page.waitForTimeout(6_000);
      expect(tracked.requests.length).toBe(before);
      await expect(page.getByText(title)).toHaveCount(0);

      await setVisibility(page, "visible");
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 3_000 });
    } finally {
      await deleteSeries(request, seriesId);
    }
  });

  test("a live meeting that loses its network catches up on reconnect without losing issues", async ({
    page,
    context,
    request,
  }) => {
    const seriesId = await createSeries(request, `Offline polling ${randomUUID().slice(0, 6)}`);
    const meetingId = await createMeeting(request, seriesId, { status: "live" });
    try {
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(page.getByText("Polling notes stay readable").first()).toBeVisible();

      await context.setOffline(true);
      const first = `Raised offline A ${randomUUID().slice(0, 6)}`;
      const second = `Raised offline B ${randomUUID().slice(0, 6)}`;
      await raiseIssue(request, seriesId, meetingId, first);
      await raiseIssue(request, seriesId, meetingId, second);
      await page.waitForTimeout(5_000);
      await context.setOffline(false);

      await expect(page.getByText(first).first()).toBeVisible({ timeout: 8_000 });
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
    const seriesId = await createSeries(request, `Ending polling ${randomUUID().slice(0, 6)}`);
    const meetingId = await createMeeting(request, seriesId, { status: "live" });
    try {
      const tracked = trackMeetingRequests(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(page.getByText("Polling notes stay readable").first()).toBeVisible();

      await rest(request, `meetings?id=eq.${meetingId}`, {
        method: "PATCH",
        data: {
          status: "completed",
          completed_at: new Date().toISOString(),
          recap_markdown: "## Summary\n\nThe recap landed while the page was open.",
          recap_generated_at: new Date().toISOString(),
        },
      });
      await expect(page.getByText("The recap landed while the page was open.").first()).toBeVisible({
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

  test("a 3-hour transcript still shows and the page stays responsive", async ({ page, request }) => {
    const seriesId = await createSeries(request, `Long polling ${randomUUID().slice(0, 6)}`);
    const sentence = "We reviewed the migration plan and agreed on next steps for the release. ";
    const longTranscript = `${sentence.repeat(2_400)}End of the three hour meeting.`;
    const meetingId = await createMeeting(request, seriesId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      transcript_raw: longTranscript,
    });
    try {
      const tracked = trackMeetingRequests(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(page.getByText("Polling notes stay readable").first()).toBeVisible();

      await page.getByRole("button", { name: /^Transcript/ }).click();
      const transcriptBox = page.getByPlaceholder("Paste transcript...");
      await expect(transcriptBox).toHaveValue(/End of the three hour meeting\.$/, { timeout: 5_000 });

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
    const seriesId = await createSeries(request, `Done polling ${randomUUID().slice(0, 6)}`);
    const meetingId = await createMeeting(request, seriesId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      transcript_raw: TRANSCRIPT,
    });
    try {
      const tracked = trackMeetingRequests(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(page.getByText("Polling notes stay readable").first()).toBeVisible();
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
    const seriesId = await createSeries(request, `Device polling ${randomUUID().slice(0, 6)}`);
    const meetingId = await createMeeting(request, seriesId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      transcription_provider: "device",
      transcription_status: "pending",
    });
    try {
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await expect(page.getByText("Polling notes stay readable").first()).toBeVisible();
      await page.waitForTimeout(1_000);

      await rest(request, `meetings?id=eq.${meetingId}`, {
        method: "PATCH",
        data: {
          transcript_raw: "The device heard the vendor migration update.",
          transcription_status: "completed",
          transcription_completed_at: new Date().toISOString(),
        },
      });

      await expect(page.getByText("Transcript ready. Check action items below.")).toBeVisible({
        timeout: 8_000,
      });
      await page.getByRole("button", { name: /^Transcript/ }).click();
      await expect(page.getByPlaceholder("Paste transcript...")).toHaveValue(
        "The device heard the vendor migration update."
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
    const meetingId = await createMeeting(request, seriesId, { status: "completed" });
    try {
      await raiseIssue(request, seriesId, meetingId, "Open item", "open");
      await raiseIssue(request, seriesId, meetingId, "In progress item", "in_progress");
      await raiseIssue(request, seriesId, meetingId, "Resolved item", "resolved");
      await raiseIssue(request, seriesId, meetingId, "Dropped item", "dropped");

      await page.goto("/series");
      const card = page.locator(`a[href="/series/${seriesId}"]:has(h2)`);
      await expect(card).toContainText("2 open issues");

      await rest(request, `issues?series_id=eq.${seriesId}&title=eq.Open item`, {
        method: "PATCH",
        data: { status: "resolved" },
      });
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
    const seriesId = await createSeries(request, `Empty polling ${randomUUID().slice(0, 6)}`);
    try {
      const meetingListRequests: string[] = [];
      page.on("request", (req) => {
        const url = decodeURIComponent(req.url());
        if (url.includes("/rest/v1/meetings?") && url.includes(`series_id=eq.${seriesId}`)) {
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
});
