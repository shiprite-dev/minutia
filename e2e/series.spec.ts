import { test, expect } from "@playwright/test";

test.describe("Series", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("series list page loads", async ({ page }) => {
    await page.goto("/series");

    await expect(page.getByRole("heading", { name: /Series/i })).toBeVisible();
  });

  test("series detail page loads with correct structure", async ({ page }) => {
    await page.goto("/series");

    // Try to click first series if available
    const seriesLink = page.locator("a[href^='/series/']").first();

    if (await seriesLink.isVisible().catch(() => false)) {
      await seriesLink.click();
      await page.waitForLoadState("networkidle");

      // Should be on a detail page
      expect(page.url()).toMatch(/\/series\/[^/]+$/);
    }
  });

  test("meeting detail page loads from series", async ({ page }) => {
    await page.goto("/series");

    const seriesLink = page.locator("a[href^='/series/']").first();

    if (await seriesLink.isVisible().catch(() => false)) {
      await seriesLink.click();

      const meetingLink = page.locator("a[href*='meetings']").first();

      if (await meetingLink.isVisible().catch(() => false)) {
        await meetingLink.click();
        await page.waitForLoadState("networkidle");

        expect(page.url()).toMatch(/\/series\/[^/]+\/meetings\/[^/]+$/);
      }
    }
  });
});
