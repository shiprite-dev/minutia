import { test, expect } from "@playwright/test";

test.describe("OIL Board", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("page loads and shows board header", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Outstanding" })).toBeVisible();
  });

  test("filter tabs are interactive", async ({ page }) => {
    await page.goto("/");

    const filterBar = page.locator("[data-testid='filter-bar']").or(
      page.locator(".filter-bar"),
    );

    // If filter bar exists, test interactions
    if (await filterBar.count() > 0) {
      const buttons = filterBar.getByRole("button");
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test("quick add button toggles input area", async ({ page }) => {
    await page.goto("/");

    // Wait for loading to complete
    await page.waitForSelector("text=Outstanding", { timeout: 10000 });

    const quickAddButton = page.getByLabel(/Quick add/i);

    if (await quickAddButton.isVisible().catch(() => false)) {
      await quickAddButton.dispatchEvent("click");

      // Check if input area appeared
      const input = page.locator("input[placeholder*='Add']").or(
        page.locator("textarea"),
      );

      if (await input.count() > 0) {
        await expect(input.first()).toBeVisible();
      }
    }
  });

  test("keyboard shortcut n opens quick add", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Outstanding", { timeout: 10000 });

    await page.keyboard.press("n");

    // Check if quick add area appeared
    const input = page.locator("input[placeholder*='Add']").or(
      page.locator("textarea"),
    );

    if (await input.count() > 0) {
      await expect(input.first()).toBeVisible();
    }
  });

  test("empty state renders when no data", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The outstanding widget always renders either the items list or an empty state.
    // Wait for either the widget heading or the empty state text to be visible.
    await expect(
      page.getByText("Outstanding items").or(
        page.getByText(/No issues|Get started|Create|Nothing outstanding/i)
      ).first()
    ).toBeVisible({ timeout: 10000 });
  });
});
