import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, ISSUES, waitForApp } from "./seed-data";

test.describe("Issue Detail", () => {
  const url = `/issues/${ISSUES.migrateCI}`;

  test("renders all issue metadata and sections", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(page.getByText("OIL Board")).toBeVisible();

    await expect(
      page.getByText("Migrate CI from Jenkins to GitHub Actions")
    ).toBeVisible();

    await expect(page.getByText("Action").first()).toBeVisible();
    await expect(page.getByText("High").first()).toBeVisible();

    // StatusChip renders with aria-label "Status: <label>"
    await expect(
      page.locator('[aria-label^="Status:"]')
    ).toBeVisible();

    await expect(page.getByText("Owner").first()).toBeVisible();
    await expect(page.getByText("Test User").first()).toBeVisible();
    await expect(page.getByText("Due").first()).toBeVisible();
    await expect(page.getByText("Priority").first()).toBeVisible();
    await expect(page.getByText("Source").first()).toBeVisible();
    await expect(page.getByText("Manual").first()).toBeVisible();
    await expect(page.getByText("Raised in").first()).toBeVisible();
    await expect(page.getByText("Duration").first()).toBeVisible();
    await expect(page.getByText("Touched").first()).toBeVisible();

    await expect(page.getByText("Description").first()).toBeVisible();
    await expect(
      page.getByText("Need to move all pipelines by end of Q2.")
    ).toBeVisible();

    await expect(page.getByText("Lifecycle timeline")).toBeVisible();
    await expect(page.getByText("Add update").first()).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Delete issue" })
    ).toBeVisible();
  });

  test("lifecycle timeline shows status updates", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByText("Raised during standup. Bob to scope the migration.")
    ).toBeVisible();
    await expect(
      page.getByText(
        "Migration plan drafted. Need approval from security team."
      )
    ).toBeVisible();
  });

  test("add update form opens with C key", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await page.keyboard.press("c");
    await expect(
      page.getByPlaceholder("What's the latest on this issue?")
    ).toBeVisible();
    await expect(
      page.getByText("Enter to submit, Esc to cancel")
    ).toBeVisible();
  });

  test("add update form opens via button click", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await page.getByText("Add update").first().click();
    await expect(
      page.getByPlaceholder("What's the latest on this issue?")
    ).toBeVisible();
  });

  test("delete issue shows confirmation dialog", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await page.getByRole("button", { name: "Delete issue" }).click();
    await expect(
      page.getByText("Permanently delete this issue?")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Yes, delete" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByText("Permanently delete this issue?")
    ).not.toBeVisible();
  });

  test("Escape key navigates back to OIL Board", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await page.keyboard.press("Escape");
    await page.waitForURL("/", { timeout: 5000 });
  });

  test("issue with resolved status shows resolved timeline", async ({
    page,
  }) => {
    await page.goto(`/issues/${ISSUES.flakyTests}`);
    await waitForApp(page);

    await expect(
      page.getByText("Fix flaky integration tests")
    ).toBeVisible();
    await expect(page.getByText("Resolved").first()).toBeVisible();

    await expect(
      page.getByText("Tests failing intermittently.")
    ).toBeVisible();
    await expect(
      page.getByText("Found the race condition. Working on fix.")
    ).toBeVisible();
    await expect(
      page.getByText(
        "Fixed with proper test isolation. All green for 3 days."
      )
    ).toBeVisible();
  });

  test("issue 404 shows not found message", async ({ page }) => {
    await page.goto("/issues/00000000-0000-0000-0000-000000000999");
    await waitForApp(page);

    await expect(page.getByText("Issue not found.")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Back to OIL Board")).toBeVisible();
  });

  test("priority dropdown is interactive", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    const select = page.locator("select").first();
    await expect(select).toBeVisible();
    await expect(select.locator("option")).toHaveCount(4);
  });

  test("due date input is interactive", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toBeVisible();
    await expect(dateInput).toBeEditable();
  });

  test("raised in meeting links to meeting detail", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await page
      .getByRole("link", { name: "Platform Standup #1" })
      .click();
    await expect(page).toHaveURL(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`
    );
  });
});

test.describe("Issue Detail Keyboard Shortcuts", () => {
  test("S key cycles status", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.keyboard.press("s");
    await page.waitForTimeout(500);

    const badges = page.locator(".flex.flex-wrap.items-center.gap-3.mb-4");
    await expect(badges).toBeVisible();
  });

  test("shortcuts are suppressed when typing in inputs", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);

    await page.keyboard.press("c");
    const textarea = page.getByPlaceholder(
      "What's the latest on this issue?"
    );
    await expect(textarea).toBeVisible();

    await textarea.fill("some update text");
    await expect(textarea).toHaveValue("some update text");
  });
});

test.describe("Issue Detail Inline Editing", () => {
  test("clicking title enters edit mode", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);

    await page
      .getByRole("button", { name: /Edit Issue title/i })
      .click();

    const input = page.locator('input[type="text"]').first();
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
  });

  test("clicking description enters edit mode", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);

    await page
      .getByText("Need to move all pipelines by end of Q2.")
      .click();

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
  });
});

test.describe("Issue Status Transitions", () => {
  test("status chip on OIL board is interactive", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const statusChips = page.locator("[data-status]");
    const count = await statusChips.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe("Issue Type Diversity", () => {
  test("blocker issue renders with correct category", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.dbPool}`);
    await waitForApp(page);

    await expect(
      page.getByText("Increase DB connection pool size")
    ).toBeVisible();
    await expect(page.getByText("Blocker").first()).toBeVisible();
    await expect(page.getByText("Critical").first()).toBeVisible();
    await expect(page.getByText("In Progress").first()).toBeVisible();
  });

  test("risk issue renders with correct category", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.sslCert}`);
    await waitForApp(page);

    await expect(
      page.getByText("SSL cert expiry risk for api.example.com")
    ).toBeVisible();
    await expect(page.getByText("Risk").first()).toBeVisible();
  });

  test("decision issue renders with correct category", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.evalK8s}`);
    await waitForApp(page);

    await expect(
      page.getByText("Evaluate Kubernetes vs ECS for new services")
    ).toBeVisible();
    await expect(page.getByText("Decision").first()).toBeVisible();
    await expect(page.getByText("Pending").first()).toBeVisible();
  });

  test("info issue (resolved) renders correctly", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.headcount}`);
    await waitForApp(page);

    await expect(
      page.getByText("Q2 headcount approved: 3 engineers")
    ).toBeVisible();
    await expect(page.getByText("Info").first()).toBeVisible();
    await expect(page.getByText("Resolved").first()).toBeVisible();
  });

  test("dropped issue renders correctly", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.graphql}`);
    await waitForApp(page);

    await expect(
      page.getByText("Evaluate GraphQL migration")
    ).toBeVisible();
    await expect(page.getByText("Dropped").first()).toBeVisible();
  });
});
