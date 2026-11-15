import { test, expect } from "@playwright/test";

const MEETING_URL =
  "/series/10000000-0000-0000-0000-000000000001/meetings/20000000-0000-0000-0000-000000000002";

test.describe("Meeting Notes Persistence", () => {
  test("typing notes auto-saves and persists on reload", async ({ page }) => {
    await page.goto(MEETING_URL);

    const rendered = page.getByRole("group", { name: "Edit notes" });
    const textarea = page.getByPlaceholder("Meeting notes...");
    await expect(rendered.or(textarea)).toBeVisible();
    if (await rendered.isVisible()) await rendered.click();
    await expect(textarea).toBeFocused();

    const testNote = `Auto-save test ${Date.now()}`;
    await textarea.fill(testNote);

    // Wait for debounced save (1s) plus network
    await page.waitForTimeout(2000);

    await page.reload();
    await expect(page.locator("[data-notes-rendered]").first()).toHaveText(
      testNote,
    );
    await page.getByRole("group", { name: "Edit notes" }).click();
    await expect(page.getByPlaceholder("Meeting notes...")).toHaveValue(
      testNote,
    );
  });
});
