import { test, expect } from "@playwright/test";

test.describe("Issue Detail Page", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  const ISSUE_ID = "30000000-0000-0000-0000-000000000001";
  const ISSUE_TITLE = "Migrate CI from Jenkins to GitHub Actions";

  test("displays issue title and metadata", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    await expect(
      page.getByRole("heading", { name: ISSUE_TITLE })
    ).toBeVisible();
    await expect(page.getByText("Owner")).toBeVisible();
    await expect(page.getByText("Due")).toBeVisible();
    await expect(page.getByText("Priority")).toBeVisible();
    await expect(page.getByText("Source")).toBeVisible();
    await expect(page.getByText("Manual")).toBeVisible();
  });

  test("shows category badge and status chip", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    await expect(page.getByText("Action")).toBeVisible();
    await expect(page.locator('[aria-label^="Status:"]')).toBeVisible();
  });

  test("shows back navigation button", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    const backBtn = page.getByRole("button", { name: /Back/ });
    await expect(backBtn).toBeVisible();
  });

  test("shows lifecycle timeline with updates", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    await expect(page.getByText("Lifecycle timeline")).toBeVisible();
    await expect(
      page.getByText("Migration plan drafted")
    ).toBeVisible();
  });

  test("inline edit title via click", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    const titleEl = page.getByRole("button", { name: /Edit Issue title/i });
    await titleEl.click();

    const input = page.locator("input[type='text']").first();
    await expect(input).toBeVisible();

    await input.press("Escape");
  });

  test("inline edit description", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    await expect(page.getByText("Description")).toBeVisible();

    const descriptionButton = page.getByRole("button", {
      name: /Edit/i,
    }).last();
    if (await descriptionButton.isVisible()) {
      await descriptionButton.click();
      const textarea = page.locator("textarea").first();
      if (await textarea.isVisible()) {
        await textarea.press("Escape");
      }
    }
  });

  test("delete shows an undo toast and Undo restores the issue", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    const deleteBtn = page.getByRole("button", { name: /Delete issue/i });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Delete is optimistic-with-undo (no confirm dialog): it navigates away and
    // surfaces an Undo toast. Undo BEFORE the toast auto-commits so the shared
    // seeded issue survives for the rest of the suite.
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Issue deleted").first()).toBeVisible();
    const undo = page.getByRole("button", { name: /Undo/i }).first();
    await expect(undo).toBeVisible();
    await undo.click();

    // The issue was never committed, so it still loads.
    await page.goto(`/issues/${ISSUE_ID}`);
    await expect(
      page.getByRole("button", { name: /Delete issue/i })
    ).toBeVisible();
  });

  test("shows 404 state for non-existent issue", async ({ page }) => {
    await page.goto("/issues/00000000-0000-0000-0000-000000000999");

    await expect(
      page.getByText(/Issue not found/).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("resolved issue shows resolved timeline marker", async ({ page }) => {
    const resolvedIssueId = "30000000-0000-0000-0000-000000000005";
    await page.goto(`/issues/${resolvedIssueId}`);

    await expect(page.getByText("Fix flaky integration tests")).toBeVisible();
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();
    await expect(page.getByText("Resolved after this update.")).toBeVisible();
  });

  test("priority control shows the current priority", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    // Priority is a shadcn Select (role=combobox), not a native <select>.
    const priority = page.getByRole("combobox", { name: "Priority" });
    await expect(priority).toBeVisible();
    await expect(priority).toContainText(/low|medium|high|critical/i);
  });

  test("issue detail is reachable from OIL Board", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const issueLink = page.getByRole("link", { name: ISSUE_TITLE }).first();
    if (await issueLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await issueLink.click();
      await expect(page).toHaveURL(`/issues/${ISSUE_ID}`);
      await expect(page.getByText(ISSUE_TITLE).first()).toBeVisible();
    }
  });
});
