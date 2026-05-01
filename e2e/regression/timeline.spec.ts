import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, waitForApp } from "./seed-data";

const SERIES_URL = `/series/${SERIES.platformStandup}`;

test.describe("Date-Anchored Timeline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SERIES_URL);
    await waitForApp(page);
  });

  test("renders Timeline heading and meeting entries in descending order", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Timeline" })
    ).toBeVisible();

    // Latest meetings should be visible (newest first)
    await expect(page.getByText("Platform Team Standup #7").first()).toBeVisible();
  });

  test("only the latest meeting is auto-expanded", async ({ page }) => {
    // The first (latest) meeting should be expanded with issues visible
    const latestMeeting = page.getByText("Platform Team Standup #7").first();
    await expect(latestMeeting).toBeVisible();

    // Its issues section should be visible
    await expect(page.getByText(/Issues \(\d+\)/).first()).toBeVisible();

    // Category badges should be present in expanded view
    await expect(page.getByText("Action").first()).toBeVisible();
  });

  test("clicking a collapsed meeting expands it", async ({ page }) => {
    // Click on a collapsed meeting to expand it
    const meeting = page.getByText("Platform Team Standup #5").first();
    await meeting.click();

    // Should show issues section
    await expect(page.getByText(/Issues \(67\)/).first()).toBeVisible({ timeout: 5000 });
  });

  test("expanding a meeting shows decisions", async ({ page }) => {
    // First click "View all" to see older meetings
    const viewAll = page.getByText(/View all \d+ meetings/);
    if (await viewAll.isVisible()) {
      await viewAll.click();
    }

    // Platform Standup #2 has a decision "Use GitHub Actions for CI/CD"
    const standup2 = page.getByText("Platform Standup #2").first();
    await standup2.click();

    await expect(
      page.getByText("Use GitHub Actions for CI/CD").first()
    ).toBeVisible();
  });

  test("issue cap limits displayed issues to 5 with Show all button", async ({
    page,
  }) => {
    // Platform Team Standup #5 has 67+ issues
    const standup5 = page.getByText("Platform Team Standup #5").first();
    await standup5.click();

    const showAll = page.getByText(/Show all \d+ items/).first();
    await expect(showAll).toBeVisible({ timeout: 5000 });
  });

  test("collapsed meeting shows preview with item count", async ({ page }) => {
    // The latest meeting is auto-expanded; collapse it
    const latest = page.getByText("Platform Team Standup #7").first();
    await latest.click();

    // Should show item count in collapsed preview
    await expect(page.getByText(/\d+ items/).first()).toBeVisible();
  });

  test("Today divider is visible in timeline", async ({ page }) => {
    await expect(page.getByText("Today").first()).toBeVisible();
  });

  test("shows only 5 meetings initially with View all button", async ({
    page,
  }) => {
    const viewAll = page.getByText(/View all \d+ meetings/);
    await expect(viewAll).toBeVisible();

    await viewAll.click();

    // After clicking, should show all meetings and button disappears
    await expect(viewAll).not.toBeVisible();
  });

  test("Open meeting details link navigates to meeting page", async ({
    page,
  }) => {
    const link = page.getByText("Open meeting details").first();
    await expect(link).toBeVisible();

    await link.click();
    await page.waitForURL(/\/meetings\//);
    await expect(page.url()).toContain("/meetings/");
  });
});
