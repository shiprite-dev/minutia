import { test as setup, expect } from "@playwright/test";

setup("authenticate", async ({ page }) => {
  // Use the app's own login flow (Guest button calls signInWithPassword)
  await page.goto("/login");

  const setupHeading = page.getByRole("heading", { name: "Instance Setup" });
  if (await setupHeading.isVisible().catch(() => false)) {
    throw new Error("Cannot authenticate because the app redirected to /setup. Start the Minutia Supabase stack or point NEXT_PUBLIC_SUPABASE_URL at a seeded Minutia database.");
  }

  const guestButton = page.getByRole("button", { name: "Sign in as Guest" });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  await page.waitForURL(/\/($|dashboard$)/, { timeout: 10000 });

  await page.goto("/dashboard");
  await expect(page).toHaveURL("/dashboard");

  // Save storage state for reuse across test files
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
