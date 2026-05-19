import { test, expect } from "@playwright/test";

const ISSUE_ID = "30000000-0000-0000-0000-000000000001";
const ISSUE_URL = `/issues/${ISSUE_ID}`;
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test.describe.serial("Issue Detail Keyboard Shortcuts", () => {
  async function resetIssueStatus() {
    await fetch(`${SUPABASE_URL}/rest/v1/issues?id=eq.${ISSUE_ID}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status: "open" }),
    });
  }

  test.beforeEach(resetIssueStatus);
  test.afterAll(resetIssueStatus);

  test("C key opens the update form", async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.locator("body").press("c");
    await expect(page.getByPlaceholder("What's the latest on this issue?")).toBeVisible();
  });

  test("S key cycles issue status", async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.locator("body").press("s");

    await expect(page.getByRole("combobox", { name: "Status: Pending" })).toBeVisible();
  });

  test("R key resolves the issue", async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.locator("body").press("r");

    await expect(page.getByText("Resolved").first()).toBeVisible({ timeout: 3000 });
  });

  test("Escape key navigates back", async ({ page }) => {
    await page.goto("/dashboard");
    await page.goto(ISSUE_URL);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.locator("body").press("Escape");
    await expect(page).toHaveURL("/dashboard", { timeout: 5000 });
  });
});
