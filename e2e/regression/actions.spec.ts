import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { waitForApp } from "./seed-data";

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
  const orgRows = await rest<{ id: string }[]>(
    request,
    "organizations?select=id&limit=1"
  );
  if (orgRows[0]?.id) return orgRows[0].id;

  const orgId = randomUUID();
  await rest<null>(request, "organizations", {
    method: "POST",
    data: {
      id: orgId,
      name: "Regression Workspace",
      slug: `regression-${Date.now()}`,
      created_by: TEST_USER_ID,
    },
    headers: serviceHeaders("return=minimal"),
  });
  return orgId;
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
  userId: string,
  seriesId: string
) {
  await rest<null>(request, "series_participants?on_conflict=series_id,user_id", {
    method: "POST",
    data: { series_id: seriesId, user_id: userId, role: "participant", invited_by: TEST_USER_ID },
    headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
  });
}

async function createWorkspace(request: APIRequestContext, userId = TEST_USER_ID) {
  const orgId = await getCurrentOrgId(request);
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  const seriesName = `Platform Team Standup ${Date.now()}`;

  await finishProfileSetup(request, orgId, userId);
  await rest<null>(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      organization_id: orgId,
      name: seriesName,
      cadence: "weekly",
      owner_id: userId,
    },
    headers: serviceHeaders("return=minimal"),
  });
  await addSeriesParticipant(request, userId, seriesId);
  await rest<null>(request, "meetings", {
    method: "POST",
    data: {
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: `${seriesName} Meeting`,
      date: new Date().toISOString().slice(0, 10),
      status: "completed",
    },
    headers: serviceHeaders("return=minimal"),
  });

  return { orgId, seriesId, meetingId, seriesName };
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
      series_id: "",
      raised_in_meeting_id: "",
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

async function deleteSeries(request: APIRequestContext, id: string | null) {
  if (!id) return;
  await rest<null>(request, `meeting_series?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

async function withIssues<T>(
  request: APIRequestContext,
  issueSpecs: Array<{ title: string; overrides?: Record<string, unknown> }>,
  fn: (
    issues: Array<{ id: string; title: string }>,
    workspace: Awaited<ReturnType<typeof createWorkspace>>
  ) => Promise<T>,
  userId = TEST_USER_ID
) {
  const issues: Array<{ id: string; title: string }> = [];
  const workspace = await createWorkspace(request, userId);
  try {
    for (const spec of issueSpecs) {
      issues.push(
        await createIssue(request, spec.title, {
          series_id: workspace.seriesId,
          raised_in_meeting_id: workspace.meetingId,
          ...spec.overrides,
        })
      );
    }
    return await fn(issues, workspace);
  } finally {
    await Promise.all(issues.map((issue) => deleteIssue(request, issue.id)));
    await deleteSeries(request, workspace.seriesId);
  }
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
  test("renders heading and summary counts", async ({ page, request }) => {
    test.skip(!SERVICE_KEY, "Requires Supabase service role for isolated issues");

    await withIssues(
      request,
      [
        {
          title: `Summary action ${Date.now()}`,
          overrides: { category: "action", owner_user_id: TEST_USER_ID },
        },
      ],
      async () => {
        await page.goto("/actions");
        await waitForApp(page);

        await expect(
          page.getByRole("heading", { name: "My Actions" }).first()
        ).toBeVisible();

        await expect(page.getByText(/OPEN/).first()).toBeVisible();
      }
    );
  });

  test("needs attention section shows open/in_progress issues owned by user", async ({
    page,
    request,
  }) => {
    test.skip(!SERVICE_KEY, "Requires Supabase service role for isolated issues");

    const stamp = Date.now();
    await withIssues(
      request,
      [
        {
          title: `Needs attention open ${stamp}`,
          overrides: { category: "action", owner_user_id: TEST_USER_ID },
        },
        {
          title: `Needs attention progress ${stamp}`,
          overrides: {
            category: "blocker",
            status: "in_progress",
            owner_user_id: TEST_USER_ID,
          },
        },
      ],
      async ([openIssue, progressIssue]) => {
        await page.goto("/actions");
        await waitForApp(page);

        await expect(
          page.getByText("Needs attention").first()
        ).toBeVisible();

        await expect(page.getByText(openIssue.title).first()).toBeVisible();
        await expect(page.getByText(progressIssue.title).first()).toBeVisible();
      }
    );
  });

  test("issue cards show issue keys", async ({ page, request }) => {
    test.skip(!SERVICE_KEY, "Requires Supabase service role for isolated issues");

    await withIssues(
      request,
      [
        {
          title: `Issue key action ${Date.now()}`,
          overrides: { category: "action", owner_user_id: TEST_USER_ID },
        },
      ],
      async () => {
        await page.goto("/actions");
        await waitForApp(page);

        await expect(page.getByText(/OIL-\d+/).first()).toBeVisible();
      }
    );
  });

  test("pending section shows pending issues", async ({ page, request }) => {
    test.skip(!SERVICE_KEY, "Requires Supabase service role for isolated issues");

    await withIssues(
      request,
      [
        {
          title: `Pending action ${Date.now()}`,
          overrides: {
            category: "action",
            status: "pending",
            owner_user_id: TEST_USER_ID,
          },
        },
      ],
      async ([issue]) => {
        await page.goto("/actions");
        await waitForApp(page);

        await expect(
          page.locator("button").filter({ hasText: "Pending" }).first()
        ).toBeVisible();
        await expect(page.getByText(issue.title)).toBeVisible();
      }
    );
  });

  test("completed section is collapsed by default", async ({ page, request }) => {
    test.skip(!SERVICE_KEY, "Requires Supabase service role for isolated issues");

    await withIssues(
      request,
      [
        {
          title: `Completed action ${Date.now()}`,
          overrides: {
            category: "action",
            status: "resolved",
            owner_user_id: TEST_USER_ID,
          },
        },
      ],
      async ([issue]) => {
        await page.goto("/actions");
        await waitForApp(page);

        await expect(
          page.locator("button").filter({ hasText: "Completed" }).first()
        ).toBeVisible();

        await expect(page.getByText(issue.title)).not.toBeVisible();
      }
    );
  });

  test("completed section expands on click", async ({ page, request }) => {
    test.skip(!SERVICE_KEY, "Requires Supabase service role for isolated issues");

    await withIssues(
      request,
      [
        {
          title: `Completed expandable action ${Date.now()}`,
          overrides: {
            category: "action",
            status: "resolved",
            owner_user_id: TEST_USER_ID,
          },
        },
      ],
      async ([issue]) => {
        await page.goto("/actions");
        await waitForApp(page);

        await page
          .locator("button")
          .filter({ hasText: "Completed" })
          .first()
          .click();
        await expect(page.getByText(issue.title)).toBeVisible();
      }
    );
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

    const email = `actions-mixed-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
      userId = await createAuthUser(request, email);
      await withIssues(
        request,
        [
          {
            title: `Assigned action ${Date.now()}`,
            overrides: { category: "action", owner_user_id: userId },
          },
          {
            title: `Assigned info ${Date.now()}`,
            overrides: { owner_user_id: userId },
          },
        ],
        async ([actionIssue, infoIssue]) => {
          const { context, page } = await newAuthedPage(browser, request, email);
          try {
            await page.goto(`${APP_URL}/actions`);
            await waitForApp(page);

            await expect(page.getByText(actionIssue.title)).toBeVisible();
            await expect(page.getByText(infoIssue.title)).not.toBeVisible();
          } finally {
            await context.close();
          }
        },
        userId
      );
    } finally {
      await deleteAuthUser(request, userId);
    }
  });

  test("shows empty state when only assigned info items exist", async ({
    browser,
    request,
  }) => {
    test.skip(!SERVICE_KEY || !ANON_KEY, "Requires Supabase service and anon keys");

    const email = `actions-info-only-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
      userId = await createAuthUser(request, email);
      await withIssues(
        request,
        [
          {
            title: `Only assigned info ${Date.now()}`,
            overrides: { owner_user_id: userId },
          },
        ],
        async ([infoIssue]) => {
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
        },
        userId
      );
    } finally {
      await deleteAuthUser(request, userId);
    }
  });

  test("series tag overlays are visible on issue cards", async ({ page, request }) => {
    test.skip(!SERVICE_KEY, "Requires Supabase service role for isolated issues");

    await withIssues(
      request,
      [
        {
          title: `Series tag action ${Date.now()}`,
          overrides: { category: "action", owner_user_id: TEST_USER_ID },
        },
      ],
      async () => {
        await page.goto("/actions");
        await waitForApp(page);

        await expect(
          page.getByText("Platform Team Standup").first()
        ).toBeVisible();
      }
    );
  });
});
