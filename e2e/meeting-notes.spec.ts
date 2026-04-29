import { test, expect } from "@playwright/test";

const MEETING_URL =
  "/series/10000000-0000-0000-0000-000000000001/meetings/20000000-0000-0000-0000-000000000002";

test.describe("Meeting Notes Persistence", () => {
  test("typing notes auto-saves and persists on reload", async ({ page }) => {
    await page.goto(MEETING_URL);

    const textarea = page.getByPlaceholder("Meeting notes");
    await expect(textarea).toBeVisible();

    const testNote = `Auto-save test ${Date.now()}`;
    await textarea.fill(testNote);

    // Wait for debounced save (1s) plus network
    await page.waitForTimeout(2000);

    // Reload and verify persistence
    await page.reload();
    const reloadedTextarea = page.getByPlaceholder("Meeting notes");
    await expect(reloadedTextarea).toHaveValue(testNote);
  });
});
