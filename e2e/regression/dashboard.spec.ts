import { test, expect, type Page } from "@playwright/test";
import {
  createDashboardIssue,
  deleteIssue,
  expandOutstandingPreview,
  gotoDashboard,
  groupBySeries,
  HAS_SERVICE_ROLE,
  issueRow,
  outstandingWidget,
  selectRowStatus,
  widget,
} from "./dashboard-helpers";

async function watchDelayedIssueDetailFetch(page: Page, delayMs = 1200) {
  let completedDetailFetches = 0;

  await page.route("**/rest/v1/issues?**", async (route, request) => {
    if (request.method() !== "GET") return route.continue();

    const url = decodeURIComponent(request.url());
    if (
      !url.includes("updates:issue_updates") ||
      !url.includes("raised_in_meeting:meetings")
    ) {
      return route.continue();
    }

    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ response });
    completedDetailFetches += 1;
  });

  return {
    completedCount: () => completedDetailFetches,
  };
}

async function delaySupabaseIssueWrites(page: Page, delayMs = 1200) {
  await page.route("**/rest/v1/issues**", async (route, request) => {
    if (request.method() !== "PATCH") return route.continue();
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ response });
  });
  await page.route("**/rest/v1/issue_updates**", async (route, request) => {
    if (request.method() !== "POST") return route.continue();
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ response });
  });
}

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

  test("outstanding board defaults to a flat list and toggles to by-series", async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(page.getByText("Outstanding items")).toBeVisible();
    await expect(
      outstandingWidget(page).getByRole("button", { name: "List" })
    ).toHaveAttribute("aria-pressed", "true");

    // Flat list shows open items directly, with no series group headers.
    await expect(
      issueRow(page, "Migrate CI from Jenkins to GitHub Actions")
    ).toBeVisible({ timeout: 10000 });
    await expect(outstandingWidget(page).locator("div.py-5")).toHaveCount(0);

    await groupBySeries(page);
    await expect(outstandingWidget(page).locator("div.py-5").first()).toBeVisible();
  });

  test("by-series view displays grouped issues", async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(page.getByText("Outstanding items")).toBeVisible();
    await groupBySeries(page);

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

  test("hovered issue link prefetches detail data before navigation", async ({ page }) => {
    const detailFetch = await watchDelayedIssueDetailFetch(page);
    await gotoDashboard(page);
    await expandOutstandingPreview(page);

    const title = "Migrate CI from Jenkins to GitHub Actions";
    const issueLink = issueRow(page, title).getByRole("link", { name: title });
    await expect(issueLink).toBeVisible();

    await issueLink.hover();
    await expect
      .poll(detailFetch.completedCount, { timeout: 3000 })
      .toBeGreaterThan(0);
    const completedFetchesBeforeClick = detailFetch.completedCount();

    await issueLink.click();

    await expect(page.locator("h1", { hasText: title })).toBeVisible();
    expect(detailFetch.completedCount()).toBe(completedFetchesBeforeClick);
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
    await groupBySeries(page);

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

test.describe("Dashboard status controls", () => {
  test.skip(!HAS_SERVICE_ROLE, "SUPABASE_SERVICE_ROLE_KEY is required for isolated dashboard data");

  test("status chip reflects the selected status before Supabase responds", async ({ page, request }) => {
    const issue = await createDashboardIssue(request);

    try {
      await delaySupabaseIssueWrites(page);
      await gotoDashboard(page);
      await expandOutstandingPreview(page);

      const row = issueRow(page, issue.title);
      await expect(row).toBeVisible();

      await row.getByRole("combobox", { name: "Status: Open" }).click();
      await row.getByRole("option", { name: "Pending", exact: true }).click();

      await expect(
        row.getByRole("combobox", { name: "Status: Pending" })
      ).toBeVisible({ timeout: 300 });
    } finally {
      await page.waitForTimeout(1400);
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await deleteIssue(request, issue.id);
    }
  });

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
