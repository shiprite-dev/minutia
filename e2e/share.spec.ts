import { test, expect } from "@playwright/test";

test.describe("Guest Share Links", () => {
  test.describe("Authenticated user redirects", () => {
    test("meeting share redirects to in-app meeting page", async ({ page }) => {
      await page.goto("/share/test-share-meeting-abc123");
      await page.waitForURL(/\/series\/.*\/meetings\//);
      expect(page.url()).toContain("/series/");
      expect(page.url()).toContain("/meetings/");
    });

    test("series share redirects to in-app series page", async ({ page }) => {
      await page.goto("/share/test-share-series-def456");
      await page.waitForURL(/\/series\//);
      expect(page.url()).toContain("/series/");
      expect(page.url()).not.toContain("/meetings/");
    });

    test("issue share redirects to in-app issue page", async ({ page }) => {
      await page.goto("/share/test-share-issue-ghi789");
      await page.waitForURL(/\/issues\//);
      expect(page.url()).toContain("/issues/");
    });

    test("share redirect creates inbox notification", async ({ page }) => {
      await page.goto("/share/test-share-meeting-abc123");
      await page.waitForURL(/\/series\//);

      await page.goto("/inbox");
      await expect(
        page.getByText("Someone shared a meeting with you").first()
      ).toBeVisible();
    });
  });

  test.describe("Expired and invalid links", () => {
    test("invalid token shows error", async ({ page }) => {
      await page.goto("/share/nonexistent-token-999");
      await expect(page.getByText("Invalid share link")).toBeVisible();
    });
  });
});
