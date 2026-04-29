import { test, expect } from "@playwright/test";

test.describe("Light Mode Parity", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("theme toggle exists with Light, Dark, System options", async ({ page }) => {
    await expect(page.getByText("Appearance")).toBeVisible();
    await expect(page.getByRole("button", { name: "Light" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dark" })).toBeVisible();
    await expect(page.getByRole("button", { name: "System" })).toBeVisible();
  });

  test("switching to light mode removes dark class", async ({ page }) => {
    await page.getByRole("button", { name: "Light" }).click();

    const hasDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark")
    );
    expect(hasDark).toBe(false);
  });

  test("light mode renders readable sidebar text", async ({ page }) => {
    await page.getByRole("button", { name: "Light" }).click();

    // Sidebar navigation items should be visible
    await expect(page.getByText("Outstanding")).toBeVisible();
    await expect(page.getByRole("link", { name: "Series" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  });
});
