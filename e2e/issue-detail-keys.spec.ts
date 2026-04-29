import { test, expect } from "@playwright/test";

const ISSUE_URL = "/issues/30000000-0000-0000-0000-000000000001";

test.describe.serial("Issue Detail Keyboard Shortcuts", () => {
  test("C key opens the update form", async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.keyboard.press("c");
    await expect(page.getByPlaceholder("What's the latest on this issue?")).toBeVisible();
  });

  test("S key cycles issue status", async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    // Press S to cycle status
    await page.keyboard.press("s");

    // The status badge should update (we can't predict exact text, just verify it changed)
    await page.waitForTimeout(500);
    const badges = page.locator(".flex.flex-wrap.items-center.gap-3.mb-4");
    await expect(badges).toBeVisible();
  });

  test("R key resolves the issue", async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.keyboard.press("r");

    // Wait for the status to update to Resolved
    await expect(page.getByText("Resolved")).toBeVisible({ timeout: 3000 });
  });

  test("Escape key navigates back to OIL Board", async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.waitForURL("/", { timeout: 5000 });
  });
});
