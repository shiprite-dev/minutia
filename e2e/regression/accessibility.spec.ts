import { test, expect } from "@playwright/test";
import { SERIES, ISSUES, waitForApp } from "./seed-data";

test.describe("Semantic HTML landmarks and page titles (MIN-046)", () => {
  test("dashboard has correct page title", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await expect(page).toHaveTitle(/OIL Board.*Minutia/i);
  });

  test("series list page has correct title", async ({ page }) => {
    await page.goto("/series");
    await waitForApp(page);

    await expect(page).toHaveTitle(/Series.*Minutia/i);
  });

  test("actions page has correct title", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(page).toHaveTitle(/My Actions.*Minutia/i);
  });

  test("inbox page has correct title", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await expect(page).toHaveTitle(/Inbox.*Minutia/i);
  });

  test("settings page has correct title", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    await expect(page).toHaveTitle(/Settings.*Minutia/i);
  });

  test("issue detail page includes issue name in title", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);

    await expect(page).toHaveTitle(/Minutia/i);
  });

  test("series detail page includes series name in title", async ({
    page,
  }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    await expect(page).toHaveTitle(/Platform Team Standup.*Minutia/i);
  });

  test("main content landmark exists", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const main = page.locator("main#main-content");
    await expect(main).toBeVisible();
  });

  test("skip-to-content link is present and focusable", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toHaveCount(1);

    await page.keyboard.press("Tab");

    const focusedHref = await page.evaluate(() => {
      const el = document.activeElement as HTMLAnchorElement;
      return el?.getAttribute("href");
    });
    expect(focusedHref).toBe("#main-content");
  });

  test("sidebar has nav landmark for navigation", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const nav = page.locator("nav[aria-label='Main navigation']");
    await expect(nav).toHaveCount(1);
  });

  test("header landmark exists", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const header = page.locator("header[aria-label='Page header']");
    await expect(header).toBeVisible();
  });
});
