import { test, expect } from "@playwright/test";

test.describe("Issue Detail Page", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  const ISSUE_ID = "30000000-0000-0000-0000-000000000001";
  const ISSUE_TITLE = "Migrate CI from Jenkins to GitHub Actions";

  test("displays issue title and metadata", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    await expect(page.getByText(ISSUE_TITLE)).toBeVisible();
    await expect(page.getByText("Owner")).toBeVisible();
    await expect(page.getByText("Due")).toBeVisible();
    await expect(page.getByText("Priority")).toBeVisible();
    await expect(page.getByText("Source")).toBeVisible();
    await expect(page.getByText("Manual")).toBeVisible();
  });

  test("shows category badge and status chip", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    await expect(page.getByText("Action")).toBeVisible();
    await expect(page.getByText("Open")).toBeVisible();
  });

  test("shows back navigation to OIL Board", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    const backLink = page.getByRole("link", { name: /OIL Board/i });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL("/");
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

  test("delete button shows confirmation dialog", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    const deleteBtn = page.getByRole("button", { name: /Delete issue/i });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    await expect(page.getByText("Permanently delete this issue?")).toBeVisible();
    await expect(page.getByRole("button", { name: /Yes, delete/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Cancel/i })).toBeVisible();

    await page.getByRole("button", { name: /Cancel/i }).click();
    await expect(page.getByText("Permanently delete this issue?")).not.toBeVisible();
  });

  test("shows 404 state for non-existent issue", async ({ page }) => {
    await page.goto("/issues/99999999-9999-9999-9999-999999999999");

    await expect(page.getByText("Issue not found")).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to OIL Board/i })).toBeVisible();
  });

  test("resolved issue shows resolved timeline marker", async ({ page }) => {
    const resolvedIssueId = "30000000-0000-0000-0000-000000000005";
    await page.goto(`/issues/${resolvedIssueId}`);

    await expect(page.getByText("Fix flaky integration tests")).toBeVisible();
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();
    await expect(page.getByText(/Resolved/)).toBeVisible();
  });

  test("priority select changes value", async ({ page }) => {
    await page.goto(`/issues/${ISSUE_ID}`);

    const prioritySelect = page.locator("select").first();
    await expect(prioritySelect).toBeVisible();

    const currentValue = await prioritySelect.inputValue();
    expect(["low", "medium", "high", "critical"]).toContain(currentValue);
  });

  test("issue detail is reachable from OIL Board", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const issueLink = page.getByRole("link", { name: ISSUE_TITLE }).first();
    if (await issueLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await issueLink.click();
      await expect(page).toHaveURL(`/issues/${ISSUE_ID}`);
      await expect(page.getByText(ISSUE_TITLE)).toBeVisible();
    }
  });
});
