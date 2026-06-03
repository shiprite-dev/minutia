import { test, expect } from "@playwright/test";
import {
  createDashboardIssue,
  deleteIssue,
  expandOutstandingPreview,
  gotoDashboard,
  HAS_SERVICE_ROLE,
  issueRow,
  outstandingWidget,
  selectRowStatus,
  widget,
} from "./dashboard-helpers";

test.describe("OIL Board Dashboard", () => {
  test("hero card displays open count and metrics", async ({ page }) => {
    await gotoDashboard(page);

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
    await gotoDashboard(page);

    await expect(page.getByText("Outstanding items")).toBeVisible();
    await expect(page.getByText("Grouped by series")).toBeVisible();

    await expandOutstandingPreview(page);

    await expect(
      issueRow(page, "Update API rate limiting config")
    ).toBeVisible({ timeout: 10000 });
  });

  test("outstanding issue rows show issue keys", async ({ page }) => {
    await gotoDashboard(page);
    await expandOutstandingPreview(page);

    await expect(
      issueRow(page, "Update API rate limiting config").getByText("OIL-6")
    ).toBeVisible();
  });

  test("filter pills work correctly", async ({ page }) => {
    await gotoDashboard(page);

    const filters = ["All", "Open", "Pending", "Overdue"];
    for (const label of filters) {
      const tab = page.getByRole("tab", { name: label, exact: true });
      await expect(tab).toBeVisible();
    }

    await page
      .getByRole("tab", { name: "Overdue", exact: true })
      .click();

    await expect(
      page.getByRole("tab", { name: "Overdue", exact: true })
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page
        .getByRole("link", {
          name: "Write user research summary for Q2 features",
        })
        .first()
    ).toBeVisible();

    await page.getByRole("tab", { name: "All", exact: true }).click();
  });

  test("status filters hide nonmatching issues", async ({ page }) => {
    await gotoDashboard(page);

    await page.getByRole("tab", { name: "Pending", exact: true }).click();
    await expect(issueRow(page, "Evaluate Kubernetes vs ECS for new services")).toBeVisible();
    await expect(issueRow(page, "Migrate CI from Jenkins to GitHub Actions")).not.toBeVisible();

    await page.getByRole("tab", { name: "Open", exact: true }).click();
    await expandOutstandingPreview(page);
    await expect(issueRow(page, "Migrate CI from Jenkins to GitHub Actions")).toBeVisible();
    await expect(issueRow(page, "Evaluate Kubernetes vs ECS for new services")).not.toBeVisible();
  });

  test("outstanding preview expands and collapses hidden rows", async ({ page }) => {
    await gotoDashboard(page);

    await expect(issueRow(page, "Update API rate limiting config")).not.toBeVisible();
    await expandOutstandingPreview(page);
    await expect(issueRow(page, "Update API rate limiting config")).toBeVisible();

    await outstandingWidget(page).getByRole("button", { name: "Show less" }).click();
    await expect(issueRow(page, "Update API rate limiting config")).not.toBeVisible();
  });

  test("next meeting card displays series info", async ({ page }) => {
    await gotoDashboard(page);

    await expect(page.getByText("Next meeting").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open series", exact: true })
    ).toBeVisible();
  });

  test("next meeting button opens the linked series", async ({ page }) => {
    await gotoDashboard(page);

    await page.getByRole("button", { name: "Open series", exact: true }).click();
    await expect(page).toHaveURL(/\/series\/[0-9a-f-]+/);
    await expect(page.getByText("Timeline").first()).toBeVisible();
  });

  test("age of open items card shows buckets", async ({ page }) => {
    await gotoDashboard(page);

    await expect(page.getByText("Age of open items")).toBeVisible();
    await expect(page.getByText("oldest first")).toBeVisible();
    for (const bucket of [/0.7d/, /8.14d/, /15.30d/, /30d\+/]) {
      await expect(widget(page, "age-1").getByText(bucket)).toBeVisible();
    }
  });

  test("your series card lists all series with view all link", async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(page.getByText("Your series").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "View all" })).toBeVisible();
  });

  test("series widget links navigate to series surfaces", async ({ page }) => {
    await gotoDashboard(page);

    await widget(page, "series-1").getByRole("link", { name: "View all" }).click();
    await expect(page).toHaveURL("/series");

    await gotoDashboard(page);
    await widget(page, "series-1").getByRole("link", { name: "Platform Team Standup" }).click();
    await expect(page).toHaveURL(/\/series\/[0-9a-f-]+/);
  });

  test("recent decisions widget renders decision content and source series", async ({ page }) => {
    await gotoDashboard(page);

    const decisions = widget(page, "decisions-1");
    await expect(decisions.getByText("Recent decisions")).toBeVisible();
    await expect(decisions.getByText("Use GitHub Actions for CI/CD")).toBeVisible();
    await expect(decisions.getByText("Platform Team Standup")).toBeVisible();
  });

  test("dashboard limits recent decisions request to rendered rows", async ({
    page,
  }) => {
    const decisionsRequestUrls: string[] = [];

    await page.route("**/rest/v1/decisions?**", async (route, request) => {
      decisionsRequestUrls.push(decodeURIComponent(request.url()));
      await route.continue();
    });

    await gotoDashboard(page);
    await expect(widget(page, "decisions-1")).toBeVisible();

    expect(decisionsRequestUrls.some((url) => url.includes("limit=5"))).toBe(
      true
    );
  });

  test("quick-add FAB is visible", async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.getByLabel("Quick add issue")).toBeVisible();
  });

  test("N key opens quick-add form", async ({ page }) => {
    await gotoDashboard(page);

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
    await gotoDashboard(page);

    await page.keyboard.press("j");
    const focused = page.locator("[data-focused]");
    await expect(focused).toBeVisible();

    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await expect(focused).toBeVisible();
  });

  test("clicking issue title navigates to issue detail", async ({ page }) => {
    await gotoDashboard(page);

    // Click any issue link on the outstanding board
    const link = page.locator('[aria-label*=","] a[href^="/issues/"]').first();
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();
    await expect(page).toHaveURL(/\/issues\/[0-9a-f-]+/);
  });
});

test.describe("Overdue Issue Highlighting", () => {
  test("overdue issue appears in overdue filter", async ({ page }) => {
    await gotoDashboard(page);

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
    await gotoDashboard(page);

    await expect(page.getByText(/overdue/).first()).toBeVisible();
  });
});

test.describe("Quick-Add Submit Flow", () => {
  test("submitting quick-add creates a new issue", async ({ page }) => {
    await gotoDashboard(page);

    await page.keyboard.press("n");
    const titleInput = page.getByPlaceholder("New issue title...");
    await expect(titleInput).toBeVisible();

    // Wait for series select to populate so meetings can load
    const select = page.locator("select");
    await expect(select).not.toHaveValue("", { timeout: 10000 });
    await page
      .getByLabel("Select series")
      .selectOption({ label: "Platform Team Standup" });

    await titleInput.fill("Regression test quick-add");

    const addBtn = page.getByRole("button", {
      name: "Add issue",
      exact: true,
    });
    await expect(addBtn).toBeEnabled({ timeout: 15000 });
    await addBtn.click();

    await expect(titleInput).not.toBeVisible({ timeout: 5000 });

    // Issue may be behind "+N more" due to priority sorting; verify via series page
    await page.getByRole("link", { name: /Platform Team Standup/ }).first().click();
    await expect(
      page.getByText("Regression test quick-add").first()
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Dashboard status controls", () => {
  test.skip(!HAS_SERVICE_ROLE, "SUPABASE_SERVICE_ROLE_KEY is required for isolated dashboard data");

  test("issue status chip updates row state and filter membership", async ({ page, request }) => {
    const issue = await createDashboardIssue(request);

    try {
      await gotoDashboard(page);
      await expandOutstandingPreview(page);

      const row = issueRow(page, issue.title);
      await expect(row).toBeVisible();

      await selectRowStatus(row, "Pending");
      await page.getByRole("tab", { name: "Pending", exact: true }).click();
      await expect(issueRow(page, issue.title)).toBeVisible();

      await page.getByRole("tab", { name: "Open", exact: true }).click();
      await expandOutstandingPreview(page);
      await expect(issueRow(page, issue.title)).not.toBeVisible();
    } finally {
      await deleteIssue(request, issue.id);
    }
  });
});
