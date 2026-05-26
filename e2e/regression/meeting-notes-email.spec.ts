import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { ISSUES, MEETINGS, SERIES, waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTBOX_PATH =
  process.env.MINUTIA_TEST_EMAIL_OUTBOX ??
  path.join(process.cwd(), "test-results", "meeting-notes-email-outbox.jsonl");

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
  pathPart: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${pathPart}`, {
    ...options,
    headers: {
      ...serviceHeaders(),
      ...(options.headers ?? {}),
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function getSeedOwnerId(request: APIRequestContext) {
  const rows = await rest(
    request,
    `meeting_series?id=eq.${SERIES.platformStandup}&select=owner_id`
  );
  expect(rows[0]?.owner_id).toBeTruthy();
  return rows[0].owner_id as string;
}

async function deleteSeries(request: APIRequestContext, id: string) {
  await rest(request, `meeting_series?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

async function createEmailFixture(request: APIRequestContext, status = "completed") {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  const issueId = randomUUID();
  const decisionId = randomUUID();
  const ownerId = await getSeedOwnerId(request);
  const seriesName = `Email notes coverage ${stamp}`;
  const meetingTitle = `${seriesName} sync`;
  const issueTitle = `Confirm buyer rollout ${stamp}`;
  const decisionTitle = `Use default attendee extraction ${stamp}`;

  try {
    await rest(request, "meeting_series", {
      method: "POST",
      data: {
        id: seriesId,
        name: seriesName,
        description: "Created by meeting notes email coverage.",
        cadence: "weekly",
        default_attendees: ["Ava <ava@example.com>", "ops@example.com"],
        owner_id: ownerId,
      },
    });
    await rest(request, "meetings", {
      method: "POST",
      data: {
        id: meetingId,
        series_id: seriesId,
        sequence_number: 1,
        title: meetingTitle,
        date: "2026-05-25",
        attendees: ["Mina <mina@example.com>", "No email"],
        status,
        notes_markdown: "Email test meeting notes.",
        transcript_raw: null,
        completed_at: status === "completed" ? new Date().toISOString() : null,
      },
    });
    await rest(request, "issues", {
      method: "POST",
      data: {
        id: issueId,
        series_id: seriesId,
        raised_in_meeting_id: meetingId,
        title: issueTitle,
        description: "Validate the meeting email contains direct issue context.",
        category: "action",
        status: "open",
        priority: "high",
        owner_name: "Ava",
        source: "manual",
      },
    });
    await rest(request, "decisions", {
      method: "POST",
      data: {
        id: decisionId,
        meeting_id: meetingId,
        series_id: seriesId,
        title: decisionTitle,
        rationale: "Default attendees should work without manual recipient entry.",
        made_by: "Mina",
        created_by: ownerId,
      },
    });
  } catch (error) {
    await deleteSeries(request, seriesId).catch(() => undefined);
    throw error;
  }

  return { seriesId, meetingId, meetingTitle, issueId, issueTitle, decisionTitle };
}

async function readOutbox() {
  const content = await readFile(OUTBOX_PATH, "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      to: string[];
      subject: string;
      text: string;
      html: string;
    });
}

test.describe("Meeting notes email", () => {
  test.beforeEach(async () => {
    await rm(OUTBOX_PATH, { force: true });
  });

  test("completed meeting can send branded notes", async ({ page }) => {
    await page.route(`**/api/meetings/${MEETINGS.standup2}/send-notes`, async (route) => {
      const body = route.request().postDataJSON() as { recipients?: string[] };
      expect(body.recipients).toEqual(["attendee@example.com"]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sent: 1 }),
      });
    });

    await page.goto(`/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup2}`);
    await waitForApp(page);

    await page.getByRole("button", { name: "Send notes" }).click();
    await page.getByLabel("Recipients").fill("attendee@example.com");
    await page.getByRole("button", { name: /^Send$/ }).click();

    await expect(page.getByText("Sent to 1 recipient.")).toBeVisible();
  });

  test("API sends branded notes with explicit recipients", async ({ request }) => {
    const response = await request.post(`/api/meetings/${MEETINGS.standup2}/send-notes`, {
      data: { recipients: ["attendee@example.com"] },
    });

    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toEqual({ sent: 1 });

    const [email] = await readOutbox();
    expect(email.to).toEqual(["attendee@example.com"]);
    expect(email.subject).toContain("Platform Standup #2");
    expect(email.text).toContain("Use GitHub Actions for CI/CD");
    expect(email.html).toContain(`/issues/${ISSUES.stagingMonitoring}`);
  });

  test("API extracts recipients from meeting and series attendees", async ({ request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated email data");

    const fixture = await createEmailFixture(request);

    try {
      const response = await request.post(`/api/meetings/${fixture.meetingId}/send-notes`, {
        data: {},
      });

      expect(response.ok()).toBeTruthy();
      await expect(response.json()).resolves.toEqual({ sent: 3 });

      const [email] = await readOutbox();
      expect(email.to).toEqual(["mina@example.com", "ava@example.com", "ops@example.com"]);
      expect(email.subject).toContain(fixture.meetingTitle);
      expect(email.text).toContain(fixture.issueTitle);
      expect(email.text).toContain(fixture.decisionTitle);
      expect(email.html).toContain(`/issues/${fixture.issueId}`);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("API rejects invalid recipients", async ({ request }) => {
    const response = await request.post(`/api/meetings/${MEETINGS.standup2}/send-notes`, {
      data: { recipients: ["not-an-email"] },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  test("API rejects incomplete meetings", async ({ request }) => {
    const response = await request.post(`/api/meetings/${MEETINGS.standup4}/send-notes`, {
      data: { recipients: ["attendee@example.com"] },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Meeting notes can only be sent after a meeting is completed.",
    });
  });
});

test.describe("Issue email links", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated send requests are rejected", async ({ page }) => {
    await page.goto("/login");

    const response = await page.evaluate(async (meetingId) => {
      const res = await fetch(`/api/meetings/${meetingId}/send-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: ["attendee@example.com"] }),
      });
      return { status: res.status, body: await res.json() };
    }, MEETINGS.standup2);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
  });

  test("unauthenticated issue links preserve next path on login", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);

    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fissues%2F${ISSUES.migrateCI}`));
    await expect(page.getByRole("button", { name: "Request invite" })).toBeDisabled();
  });
});
