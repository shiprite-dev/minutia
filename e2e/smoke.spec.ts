import { test, expect } from "@playwright/test";

/**
 * Smoke tests that verify the application boots and critical paths work.
 * These tests should pass even with minimal data setup.
 */

test.describe("Smoke Tests", () => {
  test("application boots without runtime errors", async ({ page }) => {
    await page.goto("/login");

    // Check for console errors
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.waitForLoadState("networkidle");

    // Filter out known non-critical errors
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("favicon") &&
        !e.includes("net::ERR_ABORTED") &&
        !e.includes("404"),
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test("all public routes return valid responses", async ({ request }) => {
    const routes = ["/login"];

    for (const route of routes) {
      const response = await request.get(route);
      expect(response.status(), `Route ${route} failed`).toBeLessThan(500);
    }
  });

  test("responsive layout renders on mobile", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 375, height: 667 },
    });
    const page = await context.newPage();
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "minutia" })).toBeVisible();
    await context.close();
  });

  test("responsive layout renders on tablet", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 768, height: 1024 },
    });
    const page = await context.newPage();
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "minutia" })).toBeVisible();
    await context.close();
  });

  test("responsive layout renders on desktop", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "minutia" })).toBeVisible();
    await context.close();
  });
});
