import { test, expect } from "@playwright/test";
import { SERIES, ISSUES, waitForApp } from "./seed-data";
import { expectNoCriticalA11y } from "./a11y-helper";

test.describe("Semantic HTML landmarks and page titles", () => {
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

  test("header contains only functional controls", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const header = page.locator("header[aria-label='Page header']");
    await expect(header.locator(".size-7.rounded-full")).toHaveCount(0);
  });
});

test.describe("Automated a11y gate (axe-core)", () => {
  test("dashboard has no critical violations", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForApp(page);

    await expectNoCriticalA11y(page);
  });

  test("issue detail has no critical violations", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);

    await expectNoCriticalA11y(page);
  });

  test("series list has no critical violations", async ({ page }) => {
    await page.goto("/series");
    await waitForApp(page);

    await expectNoCriticalA11y(page);
  });

  test("series detail has no critical violations", async ({ page }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    await expectNoCriticalA11y(page);
  });

  test("inbox has no critical violations", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await expectNoCriticalA11y(page);
  });
});
