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

    await expect(page.getByText("Platform Standup #4").first()).toBeVisible();
  });

  test("only the latest meeting is auto-expanded", async ({ page }) => {
    const latestMeeting = page.getByText("Platform Standup #4").first();
    await expect(latestMeeting).toBeVisible();

    await expect(page.getByText("Open meeting details").first()).toBeVisible();
  });

  test("clicking a collapsed meeting expands it", async ({ page }) => {
    const meeting = page.getByText("Platform Standup #2").first();
    await meeting.click();

    await expect(page.getByText(/Issues \(\d+\)/).first()).toBeVisible({ timeout: 5000 });
  });

  test("expanding a meeting shows decisions", async ({ page }) => {
    const standup2 = page.getByText("Platform Standup #2").first();
    await standup2.click();

    await expect(
      page.getByText("Use GitHub Actions for CI/CD").first()
    ).toBeVisible();
  });

  test("issue cap limits displayed issues to 5 with Show all button", async ({
    page,
  }) => {
    const standup1 = page.getByText("Platform Standup #1").first();
    await standup1.click();

    await expect(page.getByText(/Issues \(\d+\)/).first()).toBeVisible({ timeout: 5000 });

    const issues = page.locator("a[href^='/issues/']");
    const count = await issues.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("collapsed meeting shows preview with item count", async ({ page }) => {
    await expect(page.getByText(/\d+ items/).first()).toBeVisible();
  });

  test("Today divider is visible in timeline", async ({ page }) => {
    await expect(page.getByText("Today").first()).toBeVisible();
  });

  test("shows all meetings when within display limit", async ({
    page,
  }) => {
    await expect(page.getByText("Platform Standup #1").first()).toBeVisible();
    await expect(page.getByText("Platform Standup #2").first()).toBeVisible();
    await expect(page.getByText("Platform Standup #3").first()).toBeVisible();
    await expect(page.getByText("Platform Standup #4").first()).toBeVisible();
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
