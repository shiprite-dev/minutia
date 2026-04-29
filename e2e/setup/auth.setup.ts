import { test as setup, expect } from "@playwright/test";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

setup("authenticate", async ({ page }) => {
  // Use the app's own login flow (Guest button calls signInWithPassword)
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in as Guest" }).click();
  await page.waitForURL("/", { timeout: 10000 });
  await expect(page).toHaveURL("/");

  // Save storage state for reuse across test files
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
