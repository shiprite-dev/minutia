import { test, expect } from "@playwright/test";

const ISSUE_ID = "30000000-0000-0000-0000-000000000001";
const ISSUE_URL = `/issues/${ISSUE_ID}`;
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test.describe.serial("Issue Detail Keyboard Shortcuts", () => {
  test.afterAll(async () => {
    await fetch(`${SUPABASE_URL}/rest/v1/issues?id=eq.${ISSUE_ID}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status: "open" }),
    });
  });

  test("C key opens the update form", async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.keyboard.press("c");
    await expect(page.getByPlaceholder("What's the latest on this issue?")).toBeVisible();
  });

  test("S key cycles issue status", async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.keyboard.press("s");

    await page.waitForTimeout(500);
    const badges = page.locator(".flex.flex-wrap.items-center.gap-3.mb-4");
    await expect(badges).toBeVisible();
  });

  test("R key resolves the issue", async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.keyboard.press("r");

    await expect(page.getByText("Resolved")).toBeVisible({ timeout: 3000 });
  });

  test("Escape key navigates back", async ({ page }) => {
    await page.goto("/");
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.waitForURL("/", { timeout: 5000 });
  });
});
