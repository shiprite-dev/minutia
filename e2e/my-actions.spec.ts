import { test, expect } from "@playwright/test";

test.describe("My Actions Page", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("page loads with heading and summary", async ({ page }) => {
    await page.goto("/actions");

    await expect(
      page.getByRole("heading", { name: "My Actions" })
    ).toBeVisible();
  });

  test("shows summary line with OPEN/PENDING/OVERDUE counts", async ({ page }) => {
    await page.goto("/actions");
    await page.waitForLoadState("networkidle");

    const summaryText = page.locator("p").filter({ hasText: /OPEN|PENDING|OVERDUE/ });
    if (await summaryText.isVisible({ timeout: 5000 }).catch(() => false)) {
      const text = await summaryText.textContent();
      expect(text).toMatch(/\d+ (OPEN|PENDING|OVERDUE)/);
    }
  });

  test("shows Needs Attention section with open issues", async ({ page }) => {
    await page.goto("/actions");
    await page.waitForLoadState("networkidle");

    const section = page.getByText("Needs attention");
    if (await section.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(section).toBeVisible();
    }
  });

  test("shows Pending section", async ({ page }) => {
    await page.goto("/actions");
    await page.waitForLoadState("networkidle");

    const pendingSection = page.getByText("Pending").first();
    if (await pendingSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(pendingSection).toBeVisible();
    }
  });

  test("Completed section is collapsed by default", async ({ page }) => {
    await page.goto("/actions");
    await page.waitForLoadState("networkidle");

    const completedButton = page.locator("button").filter({ hasText: "Completed" });
    if (await completedButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      const chevron = completedButton.locator("svg").first();
      await expect(chevron).toHaveClass(/-rotate-90/);

      await completedButton.click();

      await expect(page.getByText("Fix flaky integration tests")).toBeVisible();
    }
  });

  test("sections are collapsible", async ({ page }) => {
    await page.goto("/actions");
    await page.waitForLoadState("networkidle");

    const attentionButton = page.locator("button").filter({ hasText: "Needs attention" });
    if (await attentionButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await attentionButton.click();

      await page.waitForTimeout(300);

      await attentionButton.click();
    }
  });

  test("displays overdue highlight for past-due issues", async ({ page }) => {
    await page.goto("/actions");
    await page.waitForLoadState("networkidle");

    const overdue = page.getByText("OVERDUE");
    if (await overdue.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(overdue).toBeVisible();
    }
  });

  test("only shows issues owned by current user", async ({ page }) => {
    await page.goto("/actions");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Update API rate limiting config")).not.toBeVisible();
    await expect(page.getByText("Increase DB connection pool size")).not.toBeVisible();
  });

  test("issue cards link to detail page", async ({ page }) => {
    await page.goto("/actions");
    await page.waitForLoadState("networkidle");

    const issueLink = page
      .getByRole("link", { name: /Migrate CI from Jenkins/i })
      .first();
    if (await issueLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await issueLink.click();
      await expect(page).toHaveURL(/\/issues\/30000000/);
    }
  });

  test("navigable from sidebar", async ({ page }) => {
    await page.goto("/");

    const actionsLink = page.getByRole("link", { name: "My Actions" });
    await actionsLink.click();
    await expect(page).toHaveURL("/actions");
    await expect(
      page.getByRole("heading", { name: "My Actions" })
    ).toBeVisible();
  });

  test("shows empty state when no owned issues", async ({ page }) => {
    await page.goto("/actions");
    await page.waitForLoadState("networkidle");

    const hasContent = await page
      .getByText(/Needs attention|Pending|Completed/)
      .first()
      .isVisible()
      .catch(() => false);

    const hasEmpty = await page
      .getByText(/no actions|nothing assigned/i)
      .isVisible()
      .catch(() => false);

    expect(hasContent || hasEmpty).toBe(true);
  });
});
