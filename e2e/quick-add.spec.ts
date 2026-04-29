import { test, expect } from "@playwright/test";

test.describe("Quick Add FAB", () => {
  test("FAB is visible on the OIL Board", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    const fab = page.getByLabel("Quick add issue");
    await expect(fab).toBeVisible();
  });

  test("N key opens the quick-add form", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.keyboard.press("n");

    await expect(page.getByPlaceholder("New issue title...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add issue", exact: true })).toBeVisible();
  });

  test("clicking FAB toggles the form", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    const fab = page.getByLabel("Quick add issue");
    await fab.click();

    await expect(page.getByPlaceholder("New issue title...")).toBeVisible();

    // Click again to close
    await fab.click();
    await expect(page.getByPlaceholder("New issue title...")).not.toBeVisible();
  });

  test("submitting the form creates a new issue", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.keyboard.press("n");

    const titleInput = page.getByPlaceholder("New issue title...");
    await expect(titleInput).toBeVisible();

    const testTitle = `Quick add test ${Date.now()}`;
    await titleInput.fill(testTitle);

    await page.getByRole("button", { name: "Add issue", exact: true }).click();

    // Form should close after submission
    await expect(titleInput).not.toBeVisible({ timeout: 5000 });

    // New issue should appear in the Outstanding items list
    await expect(page.getByText(testTitle)).toBeVisible({ timeout: 5000 });
  });
});
