import { test, expect } from "@playwright/test";

test.describe("Command Palette", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("opens with Cmd+K", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Meta+k");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const input = dialog.locator("input");
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute(
      "placeholder",
      /Search pages, series, issues/
    );
  });

  test("closes with Escape", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("toggles with repeated Cmd+K", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("shows navigation items", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");

    await expect(dialog.getByText("Go to OIL Board")).toBeVisible();
    await expect(dialog.getByText("Go to Series")).toBeVisible();
    await expect(dialog.getByText("Go to My Actions")).toBeVisible();
    await expect(dialog.getByText("Go to Settings")).toBeVisible();
  });

  test("navigates to page on selection", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");

    await dialog.getByText("Go to My Actions").click();
    await expect(page).toHaveURL("/actions");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("shows series results", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");

    const input = dialog.locator("input");
    await input.fill("Platform");

    await expect(dialog.getByText("Platform Team Standup")).toBeVisible({
      timeout: 5000,
    });
  });

  test("shows issue results", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");

    const input = dialog.locator("input");
    await input.fill("Migrate CI");

    await expect(
      dialog.getByText("Migrate CI from Jenkins to GitHub Actions")
    ).toBeVisible({ timeout: 5000 });
  });

  test("shows empty state for no results", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");

    const input = dialog.locator("input");
    await input.fill("xyznonexistentquery123");

    await expect(dialog.getByText("No results found.")).toBeVisible({
      timeout: 5000,
    });
  });

  test("navigates to issue detail on selection", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");

    const input = dialog.locator("input");
    await input.fill("Migrate CI");

    const issueItem = dialog.getByText(
      "Migrate CI from Jenkins to GitHub Actions"
    );
    await issueItem.click();

    await expect(page).toHaveURL(/\/issues\/30000000/);
  });

  test("navigates to series on selection", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Meta+k");
    const dialog = page.getByRole("dialog");

    const input = dialog.locator("input");
    await input.fill("Platform");

    await dialog.getByText("Platform Team Standup").click();

    await expect(page).toHaveURL(/\/series\/10000000/);
  });
});
