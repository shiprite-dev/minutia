import { test, expect } from "@playwright/test";

test.describe("OIL Board Keyboard Navigation", () => {
  test("J/K moves focus between issues", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    // Press J to focus first issue
    await page.keyboard.press("j");
    const focused = page.locator("[data-focused]");
    await expect(focused).toHaveCount(1);

    // Press J again to move to second
    await page.keyboard.press("j");
    await expect(focused).toHaveCount(1);

    // Press K to move back up
    await page.keyboard.press("k");
    await expect(focused).toHaveCount(1);
  });

  test("Enter on focused issue navigates to detail", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.keyboard.press("j");
    await expect(page.locator("[data-focused]")).toHaveCount(1);

    await page.keyboard.press("Enter");
    await page.waitForURL(/\/issues\//);
    expect(page.url()).toContain("/issues/");
  });

  test("ArrowDown/ArrowUp also work for navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await expect(page.locator("[data-focused]")).toHaveCount(1);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator("[data-focused]")).toHaveCount(1);
  });
});
