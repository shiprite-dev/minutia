import { test as setup, expect } from "@playwright/test";

setup.setTimeout(process.env.CI ? 90_000 : 30_000);

setup("authenticate", async ({ page }) => {
  await page.goto("/login");

  const setupHeading = page.getByRole("heading", { name: "Instance Setup" });
  if (await setupHeading.isVisible().catch(() => false)) {
    throw new Error("Cannot authenticate because the app redirected to /setup. Start the Minutia Supabase stack or point NEXT_PUBLIC_SUPABASE_URL at a seeded Minutia database.");
  }

  await page.getByLabel("Email address").fill("test@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/($|dashboard$)/, {
    timeout: process.env.CI ? 60_000 : 30_000,
    waitUntil: "domcontentloaded",
  });

  await page.goto("/dashboard");
  await expect(page).toHaveURL("/dashboard");

  // Save storage state for reuse across test files
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
