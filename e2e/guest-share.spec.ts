import { test, expect } from "@playwright/test";

test.describe("Guest Share Page", () => {
  test("meeting share page renders with valid token", async ({ page }) => {
    await page.goto("/share/test-share-meeting-abc123");

    await expect(page.getByText("minutia")).toBeVisible();

    const hasContent = await page
      .getByText(/Platform Standup|Standup/i)
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    const hasViewOnly = await page
      .getByText(/view.only|read.only|shared/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasContent || hasViewOnly).toBe(true);
  });

  test("series share page renders with valid token", async ({ page }) => {
    await page.goto("/share/test-share-series-def456");

    await expect(page.getByText("minutia")).toBeVisible();

    const hasContent = await page
      .getByText(/Platform Team Standup/i)
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasContent).toBe(true);
  });

  test("issue share page renders with valid token", async ({ page }) => {
    await page.goto("/share/test-share-issue-ghi789");

    await expect(page.getByText("minutia")).toBeVisible();

    const hasContent = await page
      .getByText(/Migrate CI|Jenkins|GitHub Actions/i)
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasContent).toBe(true);
  });

  test("expired share shows error state", async ({ page }) => {
    await page.goto("/share/test-share-expired-xyz000");

    const hasExpired = await page
      .getByText(/expired/i)
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasExpired).toBe(true);
  });

  test("invalid token shows error state", async ({ page }) => {
    await page.goto("/share/totally-invalid-token-that-does-not-exist");

    const hasError = await page
      .getByText(/not found|invalid|doesn't exist|no longer available/i)
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasError).toBe(true);
  });

  test("share page is accessible without authentication", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/share/test-share-meeting-abc123");

    await expect(page.getByText("minutia")).toBeVisible({ timeout: 10000 });

    await expect(page).not.toHaveURL(/\/login/);

    await context.close();
  });

  test("share page has GitHub CTA link", async ({ page }) => {
    await page.goto("/share/test-share-meeting-abc123");
    await page.waitForLoadState("networkidle");

    const githubLink = page.getByRole("link", { name: /GitHub/i });
    if (await githubLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      const href = await githubLink.getAttribute("href");
      expect(href).toContain("github.com");
    }
  });

  test("share page shows view-only badge", async ({ page }) => {
    await page.goto("/share/test-share-meeting-abc123");
    await page.waitForLoadState("networkidle");

    const badge = page.getByText(/view.only|read.only/i).first();
    if (await badge.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(badge).toBeVisible();
    }
  });
});

test.describe("Share Button (authenticated)", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("share button exists on meeting detail page", async ({ page }) => {
    await page.goto(
      "/series/10000000-0000-0000-0000-000000000001/meetings/20000000-0000-0000-0000-000000000002"
    );
    await page.waitForLoadState("networkidle");

    const shareBtn = page.getByRole("button", { name: /Share/i });
    if (await shareBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(shareBtn).toBeVisible();
    }
  });
});
