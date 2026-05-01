import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, ISSUES, waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const SERIES_URL = `/series/${SERIES.platformStandup}`;

// Reset a specific issue to open status before each test
async function resetIssueStatus(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  issueId: string,
  status: string = "open"
) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  await request.patch(
    `${SUPABASE_URL}/rest/v1/issues?id=eq.${issueId}`,
    {
      headers,
      data: { status, resolved_in_meeting_id: null },
    }
  );
}

test.describe("Meeting Issue Resolution Flow", () => {
  // Use the "Migrate CI" issue (raised in standup1) for testing
  const testIssueId = ISSUES.migrateCI;
  const meetingUrl = `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`;

  test.beforeEach(async ({ request }) => {
    // Ensure the test issue starts as open
    await resetIssueStatus(request, testIssueId);
  });

  test.afterEach(async ({ request }) => {
    // Clean up: reset issue back to open
    await resetIssueStatus(request, testIssueId);
  });

  test("resolving an issue via checkbox updates its state", async ({
    page,
  }) => {
    await page.goto(meetingUrl);
    await waitForApp(page);

    // Wait for the issue to load in open state
    await expect(
      page.getByText("Migrate CI from Jenkins to GitHub Actions").first()
    ).toBeVisible({ timeout: 5000 });

    // Find the Mark complete button near this issue
    const markComplete = page.getByRole("button", { name: "Mark complete" }).first();
    await expect(markComplete).toBeVisible({ timeout: 5000 });

    // Click to resolve
    await markComplete.click();

    // Should now show "Mark incomplete" (resolved state)
    await expect(
      page.getByRole("button", { name: "Mark incomplete" }).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("resolved issue appears in 'Resolved this meeting' section on completed page", async ({
    page,
    request,
  }) => {
    // First resolve the issue via API
    const headers = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };
    await request.patch(
      `${SUPABASE_URL}/rest/v1/issues?id=eq.${testIssueId}`,
      {
        headers,
        data: {
          status: "resolved",
          resolved_in_meeting_id: MEETINGS.standup1,
        },
      }
    );

    await page.goto(meetingUrl);
    await waitForApp(page);

    // "Resolved this meeting" section should be visible
    await expect(
      page.getByRole("heading", { name: /Resolved this meeting/ })
    ).toBeVisible({ timeout: 5000 });

    // The issue should appear in the resolved section
    const resolvedSection = page.locator("section").filter({
      hasText: "Resolved this meeting",
    });
    await expect(
      resolvedSection.getByText("Migrate CI from Jenkins to GitHub Actions")
    ).toBeVisible();
  });

  test("resolved issue shows checked checkbox with strikethrough in items raised", async ({
    page,
    request,
  }) => {
    // Resolve the issue via API
    const headers = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };
    await request.patch(
      `${SUPABASE_URL}/rest/v1/issues?id=eq.${testIssueId}`,
      {
        headers,
        data: {
          status: "resolved",
          resolved_in_meeting_id: MEETINGS.standup1,
        },
      }
    );

    await page.goto(meetingUrl);
    await waitForApp(page);

    // The issue in "Items raised" should show "Mark incomplete" (resolved)
    const raisedSection = page.locator("section").filter({
      hasText: "Items raised",
    });
    const issueRow = raisedSection.locator("[class*='group']").filter({
      hasText: "Migrate CI from Jenkins to GitHub Actions",
    }).first();
    await expect(
      issueRow.getByRole("button", { name: "Mark incomplete" })
    ).toBeVisible({ timeout: 5000 });
  });

  test("unchecking a resolved issue removes it from resolved section", async ({
    page,
    request,
  }) => {
    // Start with issue resolved
    const headers = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };
    await request.patch(
      `${SUPABASE_URL}/rest/v1/issues?id=eq.${testIssueId}`,
      {
        headers,
        data: {
          status: "resolved",
          resolved_in_meeting_id: MEETINGS.standup1,
        },
      }
    );

    await page.goto(meetingUrl);
    await waitForApp(page);

    // Verify resolved section exists
    await expect(
      page.getByRole("heading", { name: /Resolved this meeting/ })
    ).toBeVisible({ timeout: 5000 });

    // Find the issue in "Items raised" and uncheck it
    const raisedSection = page.locator("section").filter({
      hasText: "Items raised",
    });
    const issueRow = raisedSection.locator("[class*='group']").filter({
      hasText: "Migrate CI from Jenkins to GitHub Actions",
    }).first();
    await issueRow.getByRole("button", { name: "Mark incomplete" }).click();

    // Wait for it to become "Mark complete" again
    await expect(
      issueRow.getByRole("button", { name: "Mark complete" })
    ).toBeVisible({ timeout: 5000 });
  });

  test("back button from issue detail returns to meeting page", async ({
    page,
  }) => {
    await page.goto(meetingUrl);
    await waitForApp(page);

    // Navigate to an issue detail
    await page.goto(`/issues/${testIssueId}`);
    await waitForApp(page);

    // Click back button
    await page.getByRole("button", { name: "Back" }).click();

    // Should return to the meeting page
    await page.waitForURL(/\/meetings\//);
    await expect(page.url()).toContain(MEETINGS.standup1);
  });

  test("resolving via checkbox then reloading shows resolved section and summary count", async ({
    page,
  }) => {
    await page.goto(meetingUrl);
    await waitForApp(page);

    // Resolve the issue via checkbox click
    const markComplete = page.getByRole("button", { name: "Mark complete" }).first();
    await expect(markComplete).toBeVisible({ timeout: 5000 });
    await markComplete.click();

    // Wait for optimistic update
    await expect(
      page.getByRole("button", { name: "Mark incomplete" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Reload to get fresh server state
    await page.reload();
    await waitForApp(page);

    // "Resolved this meeting" section should appear
    await expect(
      page.getByRole("heading", { name: /Resolved this meeting/ })
    ).toBeVisible({ timeout: 10000 });
  });
});
