import { test, expect } from "@playwright/test";
import { ISSUES, waitForApp } from "./seed-data";

test.describe("OIL Board Dashboard", () => {
  test("hero card displays open count and metrics", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await expect(
      page.getByText("Open items across your series")
    ).toBeVisible();

    await expect(page.getByText(/\d+ open/).first()).toBeVisible();
    await expect(page.getByText(/\d+ pending/).first()).toBeVisible();
    await expect(page.getByText(/\d+ series/).first()).toBeVisible();

    await expect(page.getByText("Raised")).toBeVisible();
    await expect(page.getByText("Resolved").first()).toBeVisible();
  });

  test("outstanding items section displays grouped issues", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    await expect(page.getByText("Outstanding items")).toBeVisible();
    await expect(page.getByText("Grouped by series")).toBeVisible();

    await expect(
      page
        .getByRole("link", {
          name: "Migrate CI from Jenkins to GitHub Actions",
        })
        .first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("filter pills work correctly", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const filters = ["All", "Open", "Pending", "Overdue"];
    for (const label of filters) {
      const tab = page.getByRole("tab", { name: label, exact: true });
      await expect(tab).toBeVisible();
    }

    await page
      .getByRole("tab", { name: "Overdue", exact: true })
      .click();

    await expect(
      page
        .getByRole("link", {
          name: "Write user research summary for Q2 features",
        })
        .first()
    ).toBeVisible();

    await page.getByRole("tab", { name: "All", exact: true }).click();
  });

  test("next meeting card displays series info", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await expect(page.getByText("Next meeting", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open series" })
    ).toBeVisible();
  });

  test("age of open items card shows buckets", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await expect(page.getByText("Age of open items")).toBeVisible();
    await expect(page.getByText("oldest first")).toBeVisible();
  });

  test("your series card lists all series with view all link", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    await expect(page.getByText("Your series").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "View all" })).toBeVisible();
  });

  test("quick-add FAB is visible", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.getByLabel("Quick add issue")).toBeVisible();
  });

  test("N key opens quick-add form", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await page.keyboard.press("n");
    await expect(
      page.getByPlaceholder("New issue title...")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add issue", exact: true })
    ).toBeVisible();

    const select = page.locator("select");
    await expect(select).toBeVisible();
  });

  test("keyboard nav J/K moves focus on outstanding items", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    await page.keyboard.press("j");
    const focused = page.locator("[data-focused]");
    await expect(focused).toBeVisible();

    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await expect(focused).toBeVisible();
  });

  test("clicking issue title navigates to issue detail", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const link = page
      .getByRole("link", {
        name: "Migrate CI from Jenkins to GitHub Actions",
      })
      .first();
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/issues/${ISSUES.migrateCI}`));
  });
});

test.describe("Overdue Issue Highlighting", () => {
  test("overdue issue appears in overdue filter", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await page
      .getByRole("tab", { name: "Overdue", exact: true })
      .click();

    await expect(
      page
        .getByRole("link", {
          name: "Write user research summary for Q2 features",
        })
        .first()
    ).toBeVisible();
  });

  test("overdue count appears in hero summary", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await expect(page.getByText(/overdue/).first()).toBeVisible();
  });
});

test.describe("Quick-Add Submit Flow", () => {
  test("submitting quick-add creates a new issue", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await page.keyboard.press("n");
    const titleInput = page.getByPlaceholder("New issue title...");
    await expect(titleInput).toBeVisible();

    // Wait for series select to populate so meetings can load
    const select = page.locator("select");
    await expect(select).not.toHaveValue("", { timeout: 10000 });

    await titleInput.fill("Regression test quick-add");

    const addBtn = page.getByRole("button", {
      name: "Add issue",
      exact: true,
    });
    await expect(addBtn).toBeEnabled({ timeout: 15000 });
    await addBtn.click();

    await expect(titleInput).not.toBeVisible({ timeout: 5000 });

    await expect(
      page.getByText("Regression test quick-add").first()
    ).toBeVisible({ timeout: 5000 });
  });
});
