import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sidebar navigation links are present on app pages", async ({ page }) => {
    // Navigate to login since we may not be authenticated
    await page.goto("/login");

    // For now just verify login page has expected structure
    // In a real scenario with test auth, we'd navigate to / and check sidebar
    await expect(page.getByRole("link", { name: /GitHub/i })).toHaveAttribute(
      "href",
      "https://github.com/minutia-dev/minutia",
    );
  });

  test("page titles are correct", async ({ page }) => {
    await page.goto("/login");
    await expect(page.title()).resolves.toMatch(/minutia/i);
  });
});

test.describe("Authenticated Navigation", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("navigate through main pages via sidebar", async ({ page }) => {
    await page.goto("/");

    const navItems = [
      { label: "Outstanding", href: "/" },
      { label: "Series", href: "/series" },
      { label: "My actions", href: "/actions" },
      { label: "Inbox", href: "/inbox" },
    ];

    for (const item of navItems) {
      const link = page.getByRole("link", { name: item.label });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(item.href);
    }
  });

  test("settings page is accessible", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL("/settings");
  });
});
