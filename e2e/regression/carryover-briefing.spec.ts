import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_OPENROUTER_KEY = !!process.env.OPENROUTER_API_KEY;
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

async function rest(
  request: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...serviceHeaders(),
      ...(options.headers ?? {}),
    },
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

// Series with an upcoming meeting and two open issues carried in:
// one overdue with no owner, one owned and on track.
async function createCarryoverFixture(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Carry-over coverage ${stamp}`,
      description: "Created by carry-over briefing coverage.",
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
      sequence_number: 2,
      title: `Carry-over session ${stamp}`,
      date: "2026-12-01",
      attendees: ["Alice", "Bob"],
      status: "upcoming",
    },
  });

  await rest(request, "issues", {
    method: "POST",
    data: {
      id: randomUUID(),
      series_id: seriesId,
      raised_in_meeting_id: meetingId,
      title: `Overdue rollout ${stamp}`,
      description: "Overdue carry-over item with no owner.",
      category: "action",
      status: "open",
      priority: "high",
      owner_name: "",
      due_date: "2026-01-01",
      source: "manual",
    },
  });

  await rest(request, "issues", {
    method: "POST",
    data: {
      id: randomUUID(),
      series_id: seriesId,
      raised_in_meeting_id: meetingId,
      title: `Owned follow-up ${stamp}`,
      description: "Owned carry-over item on track.",
      category: "risk",
      status: "in_progress",
      priority: "medium",
      owner_name: "Alice",
      due_date: "2026-12-15",
      source: "manual",
    },
  });

  return { seriesId, meetingId };
}

test.describe("Carry-over briefing", () => {
  test("returns 503 from the real endpoint when OpenRouter is not configured", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated carry-over data");
    test.skip(HAS_OPENROUTER_KEY, "Requires OpenRouter to be unconfigured");

    const fixture = await createCarryoverFixture(request);

    try {
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);

      const response = await page.request.post(
        `/api/meetings/${fixture.meetingId}/carryover-briefing`,
        { data: {}, timeout: 20_000 }
      );
      expect(response.status()).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: "Carry-over briefing is not configured.",
      });
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("generates a briefing with deterministic counts through the backend route", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated carry-over data");
    test.skip(!HAS_OPENROUTER_KEY, "Requires OpenRouter for backend carry-over coverage");

    const fixture = await createCarryoverFixture(request);

    try {
      const response = await page.request.post(
        `/api/meetings/${fixture.meetingId}/carryover-briefing`,
        { data: {}, timeout: 60_000 }
      );
      expect(response.status()).toBe(200);

      const payload = await response.json();
      expect(payload).toMatchObject({
        prompt_version: "carryover-briefing-v1",
        issues_count: 2,
        overdue_count: 1,
        no_owner_count: 1,
      });
      expect(typeof payload.briefing_markdown).toBe("string");
      expect(payload.briefing_markdown.length).toBeGreaterThan(0);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("renders the carry-over panel in the upcoming meeting view", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated carry-over data");

    const fixture = await createCarryoverFixture(request);

    try {
      await page.route("**/api/meetings/*/carryover-briefing", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            briefing_markdown: "2 open items, 1 overdue. Overdue rollout has no owner.",
            overdue_count: 1,
            no_owner_count: 1,
            issues_count: 2,
            model: "test-model",
            prompt_version: "carryover-briefing-v1",
          }),
        });
      });

      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);

      await expect(page.getByRole("heading", { name: "Carry-over briefing" })).toBeVisible({
        timeout: 20_000,
      });
      await page.getByRole("button", { name: "Generate briefing" }).click();
      await expect(page.getByText("2 open items, 1 overdue.")).toBeVisible();
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("shows an error state when the briefing fails", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated carry-over data");

    const fixture = await createCarryoverFixture(request);

    try {
      await page.route("**/api/meetings/*/carryover-briefing", async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Carry-over briefing is not configured." }),
        });
      });

      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);

      await expect(page.getByRole("heading", { name: "Carry-over briefing" })).toBeVisible({
        timeout: 20_000,
      });
      await page.getByRole("button", { name: "Generate briefing" }).click();
      await expect(page.getByText("Carry-over briefing is not configured.")).toBeVisible();
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });
});

test.describe("Carry-over briefing auth", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("rejects unauthenticated briefing requests before checking provider config", async ({
    request,
  }) => {
    const response = await request.post(
      `/api/meetings/${randomUUID()}/carryover-briefing`,
      { data: {} }
    );
    expect(response.status()).toBe(401);
  });
});
