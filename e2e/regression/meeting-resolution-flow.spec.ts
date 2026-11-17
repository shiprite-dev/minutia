import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForApp } from "./seed-data";
import { createDashboardIssue } from "./dashboard-helpers";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

type Fixture = {
  seriesId: string;
  meetingId: string;
  url: string;
  issue: { id: string; title: string };
};

async function rest(
  request: APIRequestContext,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  data?: object,
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    data,
  });
  expect(response.ok(), `${method} ${path}: ${response.status()}`).toBeTruthy();
}

async function createFixture(request: APIRequestContext): Promise<Fixture> {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  await rest(request, "POST", "meeting_series", {
    id: seriesId,
    name: `Resolution flow ${stamp}`,
    cadence: "weekly",
    default_attendees: ["Test User"],
    owner_id: TEST_USER_ID,
  });
  await rest(request, "POST", "meetings", {
    id: meetingId,
    series_id: seriesId,
    sequence_number: 1,
    title: `Resolution session ${stamp}`,
    date: "2026-11-15",
    attendees: ["Test User"],
    status: "completed",
    completed_at: new Date().toISOString(),
  });
  const issue = await createDashboardIssue(
    request,
    `Meeting resolution coverage ${stamp}`,
    {
      series_id: seriesId,
      raised_in_meeting_id: meetingId,
    },
  );
  return {
    seriesId,
    meetingId,
    url: `/series/${seriesId}/meetings/${meetingId}`,
    issue,
  };
}

async function resolveIssue(request: APIRequestContext, fixture: Fixture) {
  await rest(request, "PATCH", `issues?id=eq.${fixture.issue.id}`, {
    status: "resolved",
    resolved_in_meeting_id: fixture.meetingId,
  });
}

function raisedIssueRow(page: Page, title: string) {
  return page
    .locator('section[aria-label="Items raised"]')
    .locator("[class*='group']")
    .filter({ hasText: title })
    .first();
}

test.describe("Meeting Issue Resolution Flow", () => {
  let fixture: Fixture;

  test.beforeEach(async ({ request }) => {
    fixture = await createFixture(request);
  });

  test.afterEach(async ({ request }) => {
    await rest(request, "DELETE", `meeting_series?id=eq.${fixture.seriesId}`);
  });

  test("resolving an issue via checkbox updates its state", async ({
    page,
  }) => {
    await page.goto(fixture.url);
    await waitForApp(page);

    const issueRow = raisedIssueRow(page, fixture.issue.title);
    await expect(issueRow).toBeVisible({ timeout: 5000 });

    const markComplete = issueRow.getByRole("button", {
      name: "Mark complete",
    });
    await expect(markComplete).toBeVisible({ timeout: 5000 });
    await markComplete.click();

    await expect(
      issueRow.getByRole("button", { name: "Mark incomplete" }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("resolved issue appears in 'Resolved this meeting' section on completed page", async ({
    page,
    request,
  }) => {
    await resolveIssue(request, fixture);

    await page.goto(fixture.url);
    await waitForApp(page);

    await expect(page.getByText("Resolved this meeting").first()).toBeVisible({
      timeout: 5000,
    });

    const resolvedSection = page.locator(
      'section[aria-label="Resolved this meeting"]',
    );
    await expect(resolvedSection.getByText(fixture.issue.title)).toBeVisible();
  });

  test("resolved issue shows checked checkbox with strikethrough in items raised", async ({
    page,
    request,
  }) => {
    await resolveIssue(request, fixture);

    await page.goto(fixture.url);
    await waitForApp(page);

    const issueRow = raisedIssueRow(page, fixture.issue.title);
    await expect(
      issueRow.getByRole("button", { name: "Mark incomplete" }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("unchecking a resolved issue removes it from resolved section", async ({
    page,
    request,
  }) => {
    await resolveIssue(request, fixture);

    await page.goto(fixture.url);
    await waitForApp(page);

    await expect(page.getByText("Resolved this meeting").first()).toBeVisible({
      timeout: 5000,
    });

    const issueRow = raisedIssueRow(page, fixture.issue.title);
    await issueRow.getByRole("button", { name: "Mark incomplete" }).click();

    await expect(
      issueRow.getByRole("button", { name: "Mark complete" }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('section[aria-label="Resolved this meeting"]'),
    ).toHaveCount(0);
  });

  test("back button from issue detail returns to meeting page", async ({
    page,
  }) => {
    await page.goto(fixture.url);
    await waitForApp(page);

    await page.goto(`/issues/${fixture.issue.id}`);
    await waitForApp(page);

    await page.getByRole("button", { name: "Back" }).click();

    await page.waitForURL(/\/meetings\//);
    expect(page.url()).toContain(fixture.meetingId);
  });

  test("resolving via checkbox then reloading shows resolved section and summary count", async ({
    page,
  }) => {
    await page.goto(fixture.url);
    await waitForApp(page);

    const issueRow = raisedIssueRow(page, fixture.issue.title);
    const markComplete = issueRow.getByRole("button", {
      name: "Mark complete",
    });
    await expect(markComplete).toBeVisible({ timeout: 5000 });
    await markComplete.click();

    await expect(
      issueRow.getByRole("button", { name: "Mark incomplete" }),
    ).toBeVisible({ timeout: 5000 });

    await page.reload();
    await waitForApp(page);

    const resolvedSection = page.locator(
      'section[aria-label="Resolved this meeting"]',
    );
    await expect(resolvedSection).toBeVisible({ timeout: 10000 });
    await expect(resolvedSection.getByText(fixture.issue.title)).toBeVisible();
    await expect(resolvedSection.getByText("1", { exact: true })).toBeVisible();
  });
});
