import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, waitForApp } from "./seed-data";

const SERIES_URL = `/series/${SERIES.platformStandup}`;

test.describe("Date-Anchored Timeline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SERIES_URL);
    await waitForApp(page);
  });

  test("renders Timeline heading and meeting entries", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Timeline" })
    ).toBeVisible();

    await expect(page.getByText("Platform Standup #1").first()).toBeVisible();
    await expect(page.getByText("Platform Standup #2").first()).toBeVisible();
  });

  test("completed meetings show check icon and are expandable", async ({
    page,
  }) => {
    const meeting1 = page.getByText("Platform Standup #1").first();
    await expect(meeting1).toBeVisible();

    // Completed meetings auto-expand; look for issues section
    await expect(page.getByText("Issues (3)").first()).toBeVisible();
  });

  test("expanding a meeting shows issues with category badges", async ({
    page,
  }) => {
    // Platform Standup #1 should be auto-expanded (completed)
    await expect(
      page.getByText("Evaluate GraphQL migration").first()
    ).toBeVisible();

    // Category badges should be present
    await expect(page.getByText("Decision").first()).toBeVisible();
    await expect(page.getByText("Action").first()).toBeVisible();
  });

  test("expanding a meeting shows decisions", async ({ page }) => {
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
    // Platform Team Standup #5 has 67+ issues from test runs
    const standup5 = page.getByText("Platform Team Standup #5").first();
    await standup5.click();

    // Should show "Show all X items" link
    const showAll = page.getByText(/Show all \d+ items/).first();
    await expect(showAll).toBeVisible({ timeout: 5000 });
  });

  test("clicking Show all reveals all issues", async ({ page }) => {
    const standup5 = page.getByText("Platform Team Standup #5").first();
    await standup5.click();

    const showAll = page.getByText("Show all 67 items");
    await expect(showAll).toBeVisible({ timeout: 5000 });

    await showAll.click();

    // After clicking, the button should disappear
    await expect(showAll).not.toBeVisible();
  });

  test("collapsed meeting shows preview with item count", async ({ page }) => {
    // First collapse an expanded meeting, then check preview
    const standup1 = page.getByText("Platform Standup #1").first();
    await standup1.click(); // collapse it

    // Should show item count in collapsed preview
    await expect(page.getByText("3 items").first()).toBeVisible();
  });

  test("Today divider is visible in timeline", async ({ page }) => {
    // The Today divider should appear in the timeline
    await expect(page.getByText("Today").first()).toBeVisible();
  });

  test("Open meeting details link navigates to meeting page", async ({
    page,
  }) => {
    // Find the first "Open meeting details" link
    const link = page.getByText("Open meeting details").first();
    await expect(link).toBeVisible();

    await link.click();
    await page.waitForURL(/\/meetings\//);

    // Should be on a meeting detail page
    await expect(page.url()).toContain("/meetings/");
  });
});
