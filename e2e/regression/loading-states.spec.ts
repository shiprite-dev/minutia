import { test, expect } from "@playwright/test";

test.describe("Loading skeleton screens (MIN-001)", () => {
  test("dashboard shows skeleton while loading", async ({ page }) => {
    await page.route("**/rest/v1/**", async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.continue();
    });

    await page.goto("/");

    const skeleton = page.locator("[data-slot='skeleton']").first();
    await expect(skeleton).toBeVisible();

    await page.waitForLoadState("networkidle");
  });

  test("series list page has loading skeleton", async ({ page }) => {
    await page.route("**/rest/v1/meeting_series**", async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.continue();
    });

    await page.goto("/series");

    const skeleton = page.locator("[data-slot='skeleton']").first();
    await expect(skeleton).toBeVisible();

    await page.waitForLoadState("networkidle");
  });

  test("no raw loading spinners in the app", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const spinners = page.locator(".animate-spin");
    const count = await spinners.count();
    expect(count).toBe(0);
  });
});
