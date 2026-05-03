import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, ISSUES, waitForApp } from "./seed-data";

test.describe("Sidebar & Navigation", () => {
  test("sidebar displays logo, nav items, series list, and user footer", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    const sidebar = page.locator("[data-slot='sidebar']").first();

    await expect(
      page.locator("a").filter({ hasText: "minutia" }).first()
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Outstanding" })
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Series" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "My actions" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Settings" })
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Platform Team Standup" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Product Review" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Incident Retro" }).first()
    ).toBeVisible();

    await expect(page.getByText("Test User").first()).toBeVisible();
    await expect(page.getByText("Free plan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("nav links navigate to correct pages", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const sidebar = page.locator("[data-slot='sidebar']").first();

    await page.getByRole("link", { name: "My actions" }).click();
    await expect(page).toHaveURL("/actions");

    await page.getByRole("link", { name: "Inbox" }).click();
    await expect(page).toHaveURL("/inbox");

    await sidebar.getByRole("link", { name: "Series" }).click();
    await expect(page).toHaveURL("/series");

    await sidebar.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL("/settings");

    await page.getByRole("link", { name: "Outstanding" }).click();
    await expect(page).toHaveURL("/");
  });

  test("sidebar series links navigate to series detail", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await page
      .getByRole("link", { name: "Platform Team Standup" })
      .first()
      .click();
    await expect(page).toHaveURL(`/series/${SERIES.platformStandup}`);
  });

  test("sidebar shows unread badge counts", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const outstandingLink = page.getByRole("link", { name: "Outstanding" });
    await expect(outstandingLink).toBeVisible();

    const inboxLink = page.getByRole("link", { name: "Inbox" });
    await expect(inboxLink).toBeVisible();
  });
});

test.describe("Full Navigation Flow", () => {
  test("dashboard -> series -> meeting -> back -> issue -> back", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.goto("/");
    await waitForApp(page);
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page
      .getByRole("link", { name: "Platform Team Standup" })
      .first()
      .click();
    await expect(page).toHaveURL(`/series/${SERIES.platformStandup}`);
    await expect(page.getByText("Timeline")).toBeVisible({
      timeout: 10000,
    });

    // Expand a collapsed meeting in the timeline
    await page.getByText("Platform Standup #2").first().click();
    const openDetails = page.getByText("Open meeting details");
    await expect(openDetails.first()).toBeVisible({ timeout: 5000 });
    // Click the last "Open meeting details" link (for the newly expanded #2)
    await openDetails.last().click();
    await expect(page).toHaveURL(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup2}`
    );

    await page
      .locator(`a[href="/series/${SERIES.platformStandup}"]`)
      .first()
      .click();
    await expect(page).toHaveURL(`/series/${SERIES.platformStandup}`);

    // Navigate to an issue directly
    await page.goto(`/issues/${ISSUES.userResearch}`);
    await waitForApp(page);
    await expect(
      page.getByText("Write user research summary for Q2 features")
    ).toBeVisible();

    await page.getByRole("link", { name: "Outstanding" }).click();
    await expect(page).toHaveURL("/");
  });
});
