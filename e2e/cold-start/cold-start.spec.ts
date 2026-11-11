import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { waitForApp } from "../regression/seed-data";

const ADMIN_NAME = "Cold Start Admin";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "cold-start-Admin-8xQ2";

const ENV_CHECK_ROWS = [
  "JWT Secret",
  "Anon Key",
  "Service Role Key",
  "Database",
  "Auth Service",
  "REST API",
] as const;

// One browser session end to end: the cold redirect, the wizard, login, the
// golden path, and the admin panel must share cookies exactly as a real operator
// experiences them. A fresh per-test context would drop the login from step (c).
test.describe.serial("Cold-start self-host gate", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("cold instance redirects to setup", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup$/);

    const status = await page.request.get("/api/setup/status");
    expect(status.ok()).toBeTruthy();
    expect(await status.json()).toMatchObject({ setup_completed: false });
  });

  test("setup wizard completes through the real UI", async () => {
    const token = process.env.MINUTIA_SETUP_TOKEN;
    if (!token) {
      throw new Error(
        "MINUTIA_SETUP_TOKEN must be set to drive the setup wizard on a cold production stack."
      );
    }

    await page.goto("/setup");

    // In production check-env is token-gated, so the six env rows only render
    // once a token-bearing check succeeds. Filling the token re-runs the check.
    await page.locator("#setup-token").fill(token);
    await page.getByRole("button", { name: "Re-check" }).click();

    for (const label of ENV_CHECK_ROWS) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    const continueButton = page.getByRole("button", { name: "Continue" });
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    await expect(
      page.getByRole("heading", { name: "Create admin account" })
    ).toBeVisible();
    await page.locator("#admin-name").fill(ADMIN_NAME);
    await page.locator("#admin-email").fill(ADMIN_EMAIL);
    await page.locator("#admin-password").fill(ADMIN_PASSWORD);
    await page.locator("#admin-password-confirm").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Create admin" }).click();
    await expect(page.getByText("Admin account created")).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Configure your instance" })
    ).toBeVisible();
    await page.locator("#instance-name").fill("Cold Start QA");
    await page.getByRole("button", { name: "Save & continue" }).click();

    await expect(
      page.getByRole("heading", { name: "Connect AI (optional)" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(
      page.getByRole("heading", { name: "Your instance is ready" })
    ).toBeVisible();
    const seedCheckbox = page.getByRole("checkbox");
    await expect(seedCheckbox).toBeChecked();
    await page.getByRole("button", { name: "Go to dashboard" }).click();

    await expect(page).toHaveURL(/\/login$/);
  });

  test("admin logs in and demo data is on the board", async () => {
    await page.goto("/login");
    await page.locator("#email").fill(ADMIN_EMAIL);
    await page.locator("#password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await waitForApp(page);

    // A wizard-created admin has has_completed_onboarding=false, so the first
    // login lands in the onboarding wizard. That is real first-run behavior:
    // assert it, then clear it to reach the board.
    await expect(page.getByText("Welcome to Minutia")).toBeVisible();
    await page.getByRole("button", { name: "Skip setup" }).click();
    await expect(page.getByText("Outstanding items")).toBeVisible();
    await expect(
      page.getByText("API credentials not shared yet").first()
    ).toBeVisible();

    // Seeded content from /api/setup/seed-demo: the "Weekly Vendor Sync" series
    // and its open blocker issue.
    await page.goto("/series");
    await waitForApp(page);
    await page
      .getByRole("link", { name: /Weekly Vendor Sync/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Weekly Vendor Sync" }).first()
    ).toBeVisible();
    await expect(
      page.getByText("API credentials not shared yet").first()
    ).toBeVisible();
  });

  test("golden path: create series, raise issue, persist across reload", async () => {
    const seriesName = `Cold golden series ${Date.now()}`;
    const issueTitle = `Cold golden issue ${Date.now()}`;

    await page.goto("/series");
    await waitForApp(page);

    await page.getByRole("button", { name: "Create series" }).click();
    const dialog = page.locator("[role='dialog']");
    await dialog.getByLabel("Name").fill(seriesName);
    await dialog
      .getByLabel("Description")
      .fill("Golden path series created on a cold instance.");
    await dialog.getByRole("radio", { name: "Weekly", exact: true }).click();
    await dialog.getByRole("button", { name: "Create series" }).click();

    await expect(dialog).not.toBeVisible();
    const card = page
      .locator('main a[href^="/series/"]')
      .filter({ hasText: seriesName });
    await expect(card).toBeVisible();
    await card.click();
    // The list page also renders the series name as a heading, so anchor on
    // the detail URL before capturing it or page.url() can race the navigation.
    await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: seriesName }).first()
    ).toBeVisible();
    const seriesUrl = page.url();

    // A fresh series has no meetings yet, and issues are raised in meetings
    // (quick add refuses without one). Start the series' first meeting and
    // capture the issue live, as a real first-run operator would.
    await page.getByRole("button", { name: "Start meeting" }).click();
    await expect(page.getByText("Live").first()).toBeVisible();
    await page.getByLabel("Capture input").fill(issueTitle);
    await page.keyboard.press("Enter");
    await expect(page.getByText(issueTitle).first()).toBeVisible();

    await page.goto(seriesUrl);
    await waitForApp(page);
    await expect(page.getByText(issueTitle).first()).toBeVisible();

    await page.reload();
    await waitForApp(page);
    await expect(page.getByText(issueTitle).first()).toBeVisible();
  });

  test("admin panel is reachable and healthy", async () => {
    await page.goto("/admin/health");
    await waitForApp(page);

    const dbRow = page.getByRole("listitem").filter({ hasText: "database" });
    await expect(dbRow).toBeVisible();
    await expect(dbRow).toContainText(/ok/i);

    const storageRow = page.getByRole("listitem").filter({ hasText: "storage" });
    await expect(storageRow).toBeVisible();
    await expect(storageRow).toContainText(/ok/i);

    // Setup guard is inverted once setup is complete: /setup no longer renders,
    // it bounces an authenticated admin back to the dashboard.
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
