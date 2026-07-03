import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, waitForApp } from "./seed-data";
import { createDashboardIssue, deleteIssue } from "./dashboard-helpers";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

async function updateIssueStatus(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  issueId: string,
  status: string,
  resolvedMeetingId: string | null = null
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
      data: { status, resolved_in_meeting_id: resolvedMeetingId },
    }
  );
}

async function createMeetingIssue(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  title = `Meeting resolution coverage ${Date.now()}`
) {
  return createDashboardIssue(request, title, {
    raised_in_meeting_id: MEETINGS.standup1,
  });
}

function raisedIssueRow(page: Parameters<Parameters<typeof test>[2]>[0]["page"], title: string) {
  return page
    .locator("section")
    .filter({ hasText: "Items raised" })
    .locator("[class*='group']")
    .filter({ hasText: title })
    .first();
}

test.describe("Meeting Issue Resolution Flow", () => {
  test.describe.configure({ mode: "serial" });
  const meetingUrl = `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`;

  test("resolving an issue via checkbox updates its state", async ({
    page,
    request,
  }) => {
    const issue = await createMeetingIssue(request);

    try {
      await page.goto(meetingUrl);
      await waitForApp(page);

      const issueRow = raisedIssueRow(page, issue.title);
      await expect(issueRow).toBeVisible({ timeout: 5000 });

      const markComplete = issueRow.getByRole("button", { name: "Mark complete" });
      await expect(markComplete).toBeVisible({ timeout: 5000 });
      await markComplete.click();

      await expect(
        issueRow.getByRole("button", { name: "Mark incomplete" })
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await deleteIssue(request, issue.id).catch(() => undefined);
    }
  });

  test("resolved issue appears in 'Resolved this meeting' section on completed page", async ({
    page,
    request,
  }) => {
    const issue = await createMeetingIssue(request);

    try {
      await updateIssueStatus(request, issue.id, "resolved", MEETINGS.standup1);

      await page.goto(meetingUrl);
      await waitForApp(page);

      await expect(
        page.getByText("Resolved this meeting").first()
      ).toBeVisible({ timeout: 5000 });

      const resolvedSection = page.locator("section").filter({
        hasText: "Resolved this meeting",
      });
      await expect(resolvedSection.getByText(issue.title)).toBeVisible();
    } finally {
      await deleteIssue(request, issue.id).catch(() => undefined);
    }
  });

  test("resolved issue shows checked checkbox with strikethrough in items raised", async ({
    page,
    request,
  }) => {
    const issue = await createMeetingIssue(request);

    try {
      await updateIssueStatus(request, issue.id, "resolved", MEETINGS.standup1);

      await page.goto(meetingUrl);
      await waitForApp(page);

      const issueRow = raisedIssueRow(page, issue.title);
      await expect(
        issueRow.getByRole("button", { name: "Mark incomplete" })
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await deleteIssue(request, issue.id).catch(() => undefined);
    }
  });

  test("unchecking a resolved issue removes it from resolved section", async ({
    page,
    request,
  }) => {
    const issue = await createMeetingIssue(request);

    try {
      await updateIssueStatus(request, issue.id, "resolved", MEETINGS.standup1);

      await page.goto(meetingUrl);
      await waitForApp(page);

      await expect(
        page.getByText("Resolved this meeting").first()
      ).toBeVisible({ timeout: 5000 });

      const issueRow = raisedIssueRow(page, issue.title);
      await issueRow.getByRole("button", { name: "Mark incomplete" }).click();

      await expect(
        issueRow.getByRole("button", { name: "Mark complete" })
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await deleteIssue(request, issue.id).catch(() => undefined);
    }
  });

  test("back button from issue detail returns to meeting page", async ({
    page,
    request,
  }) => {
    const issue = await createMeetingIssue(request);

    try {
      await page.goto(meetingUrl);
      await waitForApp(page);

      await page.goto(`/issues/${issue.id}`);
      await waitForApp(page);

      await page.getByRole("button", { name: "Back" }).click();

      await page.waitForURL(/\/meetings\//);
      await expect(page.url()).toContain(MEETINGS.standup1);
    } finally {
      await deleteIssue(request, issue.id).catch(() => undefined);
    }
  });

  test("resolving via checkbox then reloading shows resolved section and summary count", async ({
    page,
    request,
  }) => {
    const issue = await createMeetingIssue(request);

    try {
      await page.goto(meetingUrl);
      await waitForApp(page);

      const issueRow = raisedIssueRow(page, issue.title);
      const markComplete = issueRow.getByRole("button", { name: "Mark complete" });
      await expect(markComplete).toBeVisible({ timeout: 5000 });
      await markComplete.click();

      await expect(
        issueRow.getByRole("button", { name: "Mark incomplete" })
      ).toBeVisible({ timeout: 5000 });

      await page.reload();
      await waitForApp(page);

      await expect(
        page.getByText("Resolved this meeting").first()
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(issue.title).first()).toBeVisible();
    } finally {
      await deleteIssue(request, issue.id).catch(() => undefined);
    }
  });
});
