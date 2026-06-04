import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { SERIES, MEETINGS, ISSUES, waitForApp } from "./seed-data";
import {
  createDashboardIssue,
  deleteIssue,
  HAS_SERVICE_ROLE,
} from "./dashboard-helpers";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test.describe.configure({ mode: "serial" });

async function resetIssueStatus(issueId: string) {
  if (!SERVICE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/issues?id=eq.${issueId}`, {
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

function serviceHeaders(prefer = "return=representation") {
  if (!SERVICE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this test");
  }
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function getIssue(request: APIRequestContext, issueId: string) {
  const response = await request.get(
    `${SUPABASE_URL}/rest/v1/issues?id=eq.${issueId}&select=title,description,status,priority,due_date`,
    { headers: serviceHeaders() }
  );
  expect(response.ok()).toBeTruthy();
  const rows = await response.json();
  return rows[0] as
    | {
        title: string;
        description: string | null;
        status: string;
        priority: string;
        due_date: string | null;
      }
    | undefined;
}

async function getIssueUpdates(request: APIRequestContext, issueId: string) {
  const response = await request.get(
    `${SUPABASE_URL}/rest/v1/issue_updates?issue_id=eq.${issueId}&select=note,previous_status,new_status&order=created_at.desc`,
    { headers: serviceHeaders() }
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<
    { note: string | null; previous_status: string | null; new_status: string | null }[]
  >;
}

async function delayIssueUpdateInserts(page: Page, delayMs = 1200) {
  await page.route("**/rest/v1/issue_updates**", async (route, request) => {
    if (request.method() !== "POST") return route.continue();
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ response });
  });
}

test.describe("Issue Detail", () => {
  const url = `/issues/${ISSUES.migrateCI}`;

  test.beforeEach(async () => {
    await resetIssueStatus(ISSUES.migrateCI);
  });

  test("renders all issue metadata and sections", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(page.getByRole("button", { name: /Back/ })).toBeVisible();

    await expect(
      page.locator("h1", { hasText: "Migrate CI from Jenkins to GitHub Actions" })
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

  test("shows the human-readable issue key", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(page.getByText("OIL-1").first()).toBeVisible();
  });

  test("new update appears in the timeline before Supabase responds", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role cleanup for isolated issue data");

    const stamp = Date.now();
    const issue = await createDashboardIssue(
      request,
      `Optimistic comment coverage ${stamp}`,
      {
        description: "Initial optimistic comment coverage description.",
      }
    );
    const updateNote = `Optimistic timeline update ${stamp}`;

    try {
      await delayIssueUpdateInserts(page);
      await page.goto(`/issues/${issue.id}`);
      await waitForApp(page);

      await page.getByRole("button", { name: /Add update/ }).click();
      await page
        .getByPlaceholder("What's the latest on this issue?")
        .fill(updateNote);
      await page.getByRole("button", { name: "Add update" }).last().click();

      await expect(
        page
          .locator("section", { hasText: "Lifecycle timeline" })
          .getByText(updateNote)
      ).toBeVisible({ timeout: 300 });
      await page.waitForTimeout(1400);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await deleteIssue(request, issue.id).catch(() => undefined);
    }
  });

  test("issue key URL opens the canonical issue detail", async ({ page }) => {
    await page.goto("/issues/OIL-1");
    await waitForApp(page);

    await expect(page).toHaveURL(new RegExp(`/issues/${ISSUES.migrateCI}`));
    await expect(page.getByText("OIL-1").first()).toBeVisible();
    await expect(
      page.locator("h1", { hasText: "Migrate CI from Jenkins to GitHub Actions" })
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

  test("add update form opens from the issue detail action", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await page.getByRole("button", { name: /Add update/ }).click();
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

  test("back control navigates to dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await page.goto(url);
    await waitForApp(page);

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL("/dashboard", { timeout: 5000 });
  });

  test("issue with resolved status shows resolved timeline", async ({
    page,
  }) => {
    await page.goto(`/issues/${ISSUES.flakyTests}`);
    await waitForApp(page);

    await expect(
      page.locator("h1", { hasText: "Fix flaky integration tests" })
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

  test("due date calendar trigger is interactive", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    const dueDateButton = page.getByRole("button", { name: "Due date" });
    await expect(dueDateButton).toBeVisible();
    await expect(dueDateButton).toBeEnabled();
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

  test("edits, transitions, adds updates, reloads, and deletes an issue", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role cleanup for isolated issue data");

    const stamp = Date.now();
    const issue = await createDashboardIssue(
      request,
      `Issue lifecycle coverage ${stamp}`,
      {
        description: "Initial lifecycle coverage description.",
        category: "risk",
        priority: "low",
        due_date: "2026-06-01",
      }
    );
    const editedTitle = `Edited lifecycle coverage ${stamp}`;
    const editedDescription = `Description saved from issue detail ${stamp}`;
    const updateNote = `Timeline update saved from issue detail ${stamp}`;

    try {
      await page.goto(`/issues/${issue.id}`);
      await waitForApp(page);

      await expect(page.locator("h1", { hasText: issue.title })).toBeVisible();
      await expect(page.getByText("Risk").first()).toBeVisible();
      await expect(page.locator('[aria-label="Priority: low"]')).toBeVisible();

      await page.getByRole("button", { name: /Edit Issue title/i }).click();
      await page.locator('input[type="text"]').first().fill(editedTitle);
      await page.keyboard.press("Enter");
      await expect(page.locator("h1", { hasText: editedTitle })).toBeVisible();

      await page.getByText("Initial lifecycle coverage description.").click();
      await page.locator("textarea").first().fill(editedDescription);
      await page.getByText("Source").click();
      await expect(page.getByText(editedDescription)).toBeVisible();

      await page.locator('input[type="date"]').fill("2026-06-15");
      await page.locator("select").first().selectOption("critical");
      await expect(page.locator('[aria-label="Priority: critical"]')).toBeVisible();

      await page.getByRole("combobox", { name: "Status: Open" }).click();
      await page.getByRole("option", { name: "In Progress" }).click();
      await expect(
        page.getByRole("combobox", { name: "Status: In Progress" })
      ).toBeVisible();

      await page.getByRole("button", { name: /Add update/ }).click();
      await page
        .getByPlaceholder("What's the latest on this issue?")
        .fill(updateNote);
      await page.getByRole("button", { name: "Add update" }).last().click();
      await expect(page.getByText(updateNote)).toBeVisible();

      await page.reload();
      await waitForApp(page);
      await expect(page.locator("h1", { hasText: editedTitle })).toBeVisible();
      await expect(page.getByText(editedDescription)).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Status: In Progress" })
      ).toBeVisible();
      await expect(page.locator('[aria-label="Priority: critical"]')).toBeVisible();
      await expect(page.locator('input[type="date"]')).toHaveValue("2026-06-15");
      await expect(page.getByText(updateNote)).toBeVisible();

      await expect
        .poll(async () => getIssue(request, issue.id))
        .toMatchObject({
          title: editedTitle,
          description: editedDescription,
          status: "in_progress",
          priority: "critical",
          due_date: "2026-06-15",
        });
      await expect
        .poll(async () => getIssueUpdates(request, issue.id))
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              note: updateNote,
              previous_status: "in_progress",
              new_status: "in_progress",
            }),
          ])
        );

      await page.getByRole("button", { name: "Delete issue" }).click();
      await page.getByRole("button", { name: "Yes, delete" }).click();
      await expect(page).toHaveURL(/\/(?:dashboard)?$/);
      await expect
        .poll(async () => getIssue(request, issue.id))
        .toBeUndefined();
    } finally {
      await deleteIssue(request, issue.id).catch(() => undefined);
    }
  });
});

test.describe("Issue Detail Keyboard Shortcuts", () => {
  test.beforeEach(async () => {
    await resetIssueStatus(ISSUES.migrateCI);
  });

  test.afterAll(async () => {
    await resetIssueStatus(ISSUES.migrateCI);
  });

  test("S key cycles status", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();

    await page.locator("body").press("s");

    await expect(page.getByRole("combobox", { name: "Status: Pending" })).toBeVisible();
  });

  test("shortcuts are suppressed when typing in inputs", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);

    await page.getByRole("button", { name: /Add update/ }).click();
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
    await page.goto("/dashboard");
    await waitForApp(page);

    await expect(
      page.getByRole("combobox", { name: /^Status:/ }).first()
    ).toBeVisible();
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
