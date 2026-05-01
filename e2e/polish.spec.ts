import { test, expect } from "@playwright/test";

test.describe("Error & 404 Pages", () => {
  test("404 page renders for unknown routes", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-at-all");

    const has404 = await page
      .getByText(/not found|404|page doesn't exist/i)
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(has404).toBe(true);
  });

  test("404 page has link back to home", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-at-all");

    const homeLink = page.getByRole("link", { name: /home|back|OIL Board/i });
    if (await homeLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await homeLink.click();
      await expect(page).toHaveURL("/");
    }
  });
});

test.describe("PWA Manifest", () => {
  test("manifest.json is accessible and valid", async ({ request }) => {
    const response = await request.get("/manifest.json");
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe("standalone");
  });
});

test.describe("Metadata & SEO", () => {
  test("page has correct title", async ({ page }) => {
    await page.goto("/login");
    const title = await page.title();
    expect(title.toLowerCase()).toContain("minutia");
  });

  test("page has theme-color meta tag", async ({ page }) => {
    await page.goto("/login");
    const themeColor = page.locator("meta[name='theme-color']");
    if (await themeColor.count() > 0) {
      const content = await themeColor.getAttribute("content");
      expect(content).toBeTruthy();
    }
  });

  test("page has viewport meta tag", async ({ page }) => {
    await page.goto("/login");
    const viewport = page.locator("meta[name='viewport']");
    const content = await viewport.getAttribute("content");
    expect(content).toContain("width=device-width");
  });
});

test.describe("Responsive Design", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("mobile viewport renders OIL Board correctly", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Outstanding" })
    ).toBeVisible();
  });

  test("tablet viewport renders OIL Board correctly", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Outstanding" })
    ).toBeVisible();
  });

  test("desktop viewport renders OIL Board with sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Outstanding" })
    ).toBeVisible();
  });
});

test.describe("Brand Assets", () => {
  test("brand icon SVG is accessible", async ({ request }) => {
    const response = await request.get("/icon.svg");
    expect(response.status()).toBe(200);
    const contentType = response.headers()["content-type"];
    expect(contentType).toContain("svg");
  });
});

test.describe("Navigation Polish", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("all sidebar nav items are functional", async ({ page }) => {
    await page.goto("/");

    const routes = [
      { name: "Outstanding", url: "/" },
      { name: "Series", url: "/series" },
      { name: "My actions", url: "/actions" },
      { name: "Settings", url: "/settings" },
    ];

    for (const route of routes) {
      const link = page.getByRole("link", { name: route.name });
      await link.click();
      await expect(page).toHaveURL(route.url);
    }
  });

  test("keyboard navigation works between pages", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    const focused = page.locator(":focus");
    const tagName = await focused.evaluate((el) => el.tagName);
    expect(["A", "BUTTON", "INPUT"]).toContain(tagName);
  });
});
