import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { MEETINGS, SERIES, waitForApp } from "./seed-data";

const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_USER_PASSWORD = "password123";

function serviceHeaders(prefer = "return=representation") {
  if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this test");
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function rest<T>(
  request: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...serviceHeaders(),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${text}`).toBeTruthy();
  return (text ? JSON.parse(text) : null) as T;
}

async function getCurrentOrgId(request: APIRequestContext) {
  const rows = await rest<{ current_organization_id: string | null }[]>(
    request,
    `profiles?id=eq.${TEST_USER_ID}&select=current_organization_id`
  );
  const orgId = rows[0]?.current_organization_id;
  expect(orgId).toBeTruthy();
  return orgId as string;
}

async function createAuthUser(request: APIRequestContext, email: string) {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: serviceHeaders(),
    data: {
      email,
      password: TEST_USER_PASSWORD,
      email_confirm: true,
      user_metadata: { name: email.split("@")[0] },
    },
  });
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBeTruthy();
  const body = await response.json();
  return (body.id ?? body.user?.id) as string;
}

async function deleteAuthUser(request: APIRequestContext, userId: string | null) {
  if (!userId) return;
  await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: serviceHeaders("return=minimal"),
  });
}

async function finishProfileSetup(
  request: APIRequestContext,
  orgId: string,
  userId: string
) {
  await rest<null>(request, `profiles?id=eq.${userId}`, {
    method: "PATCH",
    data: {
      current_organization_id: orgId,
      has_completed_onboarding: true,
    },
    headers: serviceHeaders("return=minimal"),
  });
  await rest<null>(request, "organization_members?on_conflict=organization_id,user_id", {
    method: "POST",
    data: { organization_id: orgId, user_id: userId, role: "member" },
    headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
  });
}

async function addSeriesParticipant(
  request: APIRequestContext,
  userId: string
) {
  await rest<null>(request, "series_participants?on_conflict=series_id,user_id", {
    method: "POST",
    data: { series_id: SERIES.platformStandup, user_id: userId, role: "participant", invited_by: TEST_USER_ID },
    headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
  });
}

async function createIssue(
  request: APIRequestContext,
  title: string,
  overrides: Record<string, unknown> = {}
) {
  const id = randomUUID();
  await rest<null>(request, "issues", {
    method: "POST",
    data: {
      id,
      series_id: SERIES.platformStandup,
      raised_in_meeting_id: MEETINGS.standup1,
      title,
      description: "Created by My Actions regression coverage.",
      category: "info",
      status: "open",
      priority: "low",
      owner_name: "",
      owner_user_id: TEST_USER_ID,
      source: "manual",
      ...overrides,
    },
    headers: serviceHeaders("return=minimal"),
  });
  return { id, title };
}

async function deleteIssue(request: APIRequestContext, id: string | null) {
  if (!id) return;
  await rest<null>(request, `issues?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

async function getAccessToken(request: APIRequestContext, email: string) {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    data: { email, password: TEST_USER_PASSWORD },
  });
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function newAuthedPage(
  browser: Browser,
  request: APIRequestContext,
  email: string
) {
  const session = await getAccessToken(request, email);
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`,
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`,
      url: new URL(APP_URL).origin,
      expires: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  return { context, page: await context.newPage() };
}

test.describe("My Actions Page", () => {
  test("renders heading and summary counts", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "My Actions" }).first()
    ).toBeVisible();

    await expect(page.getByText(/OPEN/).first()).toBeVisible();
  });

  test("needs attention section shows open/in_progress issues owned by user", async ({
    page,
  }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.getByText("Needs attention").first()
    ).toBeVisible();

    await expect(
      page.getByText("Set up staging environment monitoring").first()
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Write user research summary for Q2 features").first()
    ).toBeVisible();
  });

  test("issue cards show issue keys", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(page.getByText("OIL-2").first()).toBeVisible();
  });

  test("pending section shows pending issues", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.locator("button").filter({ hasText: "Pending" }).first()
    ).toBeVisible();
    await expect(
      page.getByText("Evaluate Kubernetes vs ECS for new services")
    ).toBeVisible();
  });

  test("completed section is collapsed by default", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.locator("button").filter({ hasText: "Completed" }).first()
    ).toBeVisible();

    await expect(
      page.getByText("Fix flaky integration tests")
    ).not.toBeVisible();
  });

  test("completed section expands on click", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await page
      .locator("button")
      .filter({ hasText: "Completed" })
      .first()
      .click();
    await expect(
      page.getByText("Fix flaky integration tests")
    ).toBeVisible();
  });

  test("issues not owned by user are excluded", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.getByText("Update API rate limiting config")
    ).not.toBeVisible();

    await expect(
      page.getByText("Increase DB connection pool size")
    ).not.toBeVisible();
  });

  test("shows assigned action items but excludes assigned info items", async ({
    browser,
    request,
  }) => {
    test.skip(!SERVICE_KEY || !ANON_KEY, "Requires Supabase service and anon keys");

    const orgId = await getCurrentOrgId(request);
    const email = `actions-mixed-${Date.now()}@example.com`;
    let userId: string | null = null;
    let actionIssueId: string | null = null;
    let infoIssueId: string | null = null;

    try {
      userId = await createAuthUser(request, email);
      await finishProfileSetup(request, orgId, userId);
      await addSeriesParticipant(request, userId);

      const actionIssue = await createIssue(
        request,
        `Assigned action ${Date.now()}`,
        { category: "action", owner_user_id: userId }
      );
      const infoIssue = await createIssue(
        request,
        `Assigned info ${Date.now()}`,
        { owner_user_id: userId }
      );
      actionIssueId = actionIssue.id;
      infoIssueId = infoIssue.id;

      const { context, page } = await newAuthedPage(browser, request, email);
      try {
        await page.goto(`${APP_URL}/actions`);
        await waitForApp(page);

        await expect(page.getByText(actionIssue.title)).toBeVisible();
        await expect(page.getByText(infoIssue.title)).not.toBeVisible();
      } finally {
        await context.close();
      }
    } finally {
      await deleteIssue(request, infoIssueId);
      await deleteIssue(request, actionIssueId);
      await deleteAuthUser(request, userId);
    }
  });

  test("shows empty state when only assigned info items exist", async ({
    browser,
    request,
  }) => {
    test.skip(!SERVICE_KEY || !ANON_KEY, "Requires Supabase service and anon keys");

    const orgId = await getCurrentOrgId(request);
    const email = `actions-info-only-${Date.now()}@example.com`;
    let userId: string | null = null;
    let issueId: string | null = null;

    try {
      userId = await createAuthUser(request, email);
      await finishProfileSetup(request, orgId, userId);
      await addSeriesParticipant(request, userId);

      const infoIssue = await createIssue(
        request,
        `Only assigned info ${Date.now()}`,
        { owner_user_id: userId }
      );
      issueId = infoIssue.id;

      const { context, page } = await newAuthedPage(browser, request, email);
      try {
        await page.goto(`${APP_URL}/actions`);
        await waitForApp(page);

        await expect(page.getByText(infoIssue.title)).not.toBeVisible();
        await expect(
          page.getByText("You owe nobody anything right now.")
        ).toBeVisible();
        await expect(
          page.getByText(/Needs attention|Pending|Completed/).first()
        ).not.toBeVisible();
      } finally {
        await context.close();
      }
    } finally {
      await deleteIssue(request, issueId);
      await deleteAuthUser(request, userId);
    }
  });

  test("series tag overlays are visible on issue cards", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.getByText("Platform Team Standup").first()
    ).toBeVisible();
  });
});
