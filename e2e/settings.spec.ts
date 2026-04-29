import { test, expect } from "@playwright/test";

test.describe("Settings", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("settings page loads", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: /Settings/i })).toBeVisible();
  });

  test("profile information is displayed", async ({ page }) => {
    await page.goto("/settings");

    // Look for profile-related content
    const profileSection = page.locator("text=/Profile|Account|User/i").first();
    await expect(profileSection).toBeVisible();
  });
});
