import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type Browser, type Request } from "@playwright/test";

const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_USER_EMAIL = "test@example.com";
const TEST_USER_PASSWORD = "password123";

function serviceHeaders(prefer = "return=representation") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function rest(
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
  return text ? JSON.parse(text) : null;
}

async function getCurrentOrgId(request: APIRequestContext) {
  const rows = await rest(
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
    headers: serviceHeaders(),
  });
}

async function finishProfileSetup(
  request: APIRequestContext,
  orgId: string,
  userId: string
) {
  await rest(request, `profiles?id=eq.${userId}`, {
    method: "PATCH",
    data: {
      current_organization_id: orgId,
      has_completed_onboarding: true,
    },
    headers: serviceHeaders("return=minimal"),
  });
  await rest(request, "organization_members?on_conflict=organization_id,user_id", {
    method: "POST",
    data: { organization_id: orgId, user_id: userId, role: "member" },
    headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
  });
}

async function createSeries(
  request: APIRequestContext,
  orgId: string,
  name: string
) {
  const id = randomUUID();
  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id,
      organization_id: orgId,
      owner_id: TEST_USER_ID,
      name,
      description: `${name} description`,
      cadence: "weekly",
      default_attendees: ["Test User"],
    },
    headers: serviceHeaders("return=minimal"),
  });
  return id;
}

async function createMeeting(
  request: APIRequestContext,
  seriesId: string,
  status: "upcoming" | "live" | "completed"
) {
  const id = randomUUID();
  await rest(request, "meetings", {
    method: "POST",
    data: {
      id,
      series_id: seriesId,
      sequence_number: 1,
      title: `${status} collaboration meeting`,
      date: "2026-05-31",
      attendees: ["Test User"],
      status,
      notes_markdown: "",
    },
    headers: serviceHeaders("return=minimal"),
  });
  return id;
}

async function addSeriesParticipant(
  request: APIRequestContext,
  seriesId: string,
  userId: string,
  role: "owner" | "facilitator" | "participant" = "participant"
) {
  await rest(request, "series_participants?on_conflict=series_id,user_id", {
    method: "POST",
    data: { series_id: seriesId, user_id: userId, role, invited_by: TEST_USER_ID },
    headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
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

async function newAuthedPage(browser: Browser, request: APIRequestContext, email: string) {
  const session = await getAccessToken(request, email);
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`,
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`,
      domain: new URL(APP_URL).hostname,
      path: "/",
      expires: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  return { context, page: await context.newPage() };
}

async function countMeetings(request: APIRequestContext, seriesId: string) {
  const rows = await rest(
    request,
    `meetings?series_id=eq.${seriesId}&select=id,status`
  );
  return rows as { id: string; status: string }[];
}

test.describe("Realtime collaboration and series participation", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!SERVICE_KEY || !ANON_KEY, "Requires Supabase service and anon keys");

  test("workspace members only see series they participate in", async ({
    browser,
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    const participantEmail = `participant-${Date.now()}@example.com`;
    let participantId: string | null = null;
    const visibleSeriesName = `Visible participant series ${Date.now()}`;
    const hiddenSeriesName = `Hidden workspace series ${Date.now()}`;
    let visibleSeriesId: string | null = null;
    let hiddenSeriesId: string | null = null;

    try {
      participantId = await createAuthUser(request, participantEmail);
      await finishProfileSetup(request, orgId, participantId);
      visibleSeriesId = await createSeries(request, orgId, visibleSeriesName);
      hiddenSeriesId = await createSeries(request, orgId, hiddenSeriesName);
      await addSeriesParticipant(request, visibleSeriesId, participantId);

      const { context, page } = await newAuthedPage(browser, request, participantEmail);
      try {
        await page.goto(`${APP_URL}/series`);

        await expect(
          page.getByRole("heading", { name: visibleSeriesName })
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: hiddenSeriesName })
        ).toHaveCount(0);
      } finally {
        await context.close();
      }
    } finally {
      if (visibleSeriesId) await rest(request, `meeting_series?id=eq.${visibleSeriesId}`, { method: "DELETE", headers: serviceHeaders("return=minimal") }).catch(() => undefined);
      if (hiddenSeriesId) await rest(request, `meeting_series?id=eq.${hiddenSeriesId}`, { method: "DELETE", headers: serviceHeaders("return=minimal") }).catch(() => undefined);
      await deleteAuthUser(request, participantId);
    }
  });

  test("starting a series joins the existing live meeting without duplicating the timeline", async ({
    page,
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    const seriesName = `Live join series ${Date.now()}`;
    const seriesId = await createSeries(request, orgId, seriesName);
    const liveMeetingId = await createMeeting(request, seriesId, "live");

    try {
      await addSeriesParticipant(request, seriesId, TEST_USER_ID, "owner");

      await page.goto(`/series/${seriesId}`);
      await expect(page.getByRole("button", { name: "Join live meeting" })).toBeVisible();
      await page.getByRole("button", { name: "Join live meeting" }).click();

      await expect(page).toHaveURL(`/series/${seriesId}/meetings/${liveMeetingId}`);
      const meetings = await countMeetings(request, seriesId);
      expect(meetings.filter((meeting) => meeting.status === "live")).toHaveLength(1);
      expect(meetings).toHaveLength(1);
    } finally {
      await rest(request, `meeting_series?id=eq.${seriesId}`, { method: "DELETE", headers: serviceHeaders("return=minimal") }).catch(() => undefined);
    }
  });

  test("participants can contribute and other live participants see the item without reload", async ({
    browser,
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    const participantEmail = `live-contributor-${Date.now()}@example.com`;
    let participantId: string | null = null;
    const seriesId = await createSeries(request, orgId, `Realtime contribution ${Date.now()}`);
    const meetingId = await createMeeting(request, seriesId, "live");
    const issueTitle = `Realtime participant issue ${Date.now()}`;

    try {
      participantId = await createAuthUser(request, participantEmail);
      await finishProfileSetup(request, orgId, participantId);
      await addSeriesParticipant(request, seriesId, TEST_USER_ID, "owner");
      await addSeriesParticipant(request, seriesId, participantId, "participant");

      const owner = await newAuthedPage(browser, request, TEST_USER_EMAIL);
      const contributor = await newAuthedPage(browser, request, participantEmail);

      try {
        await owner.page.goto(`${APP_URL}/series/${seriesId}/meetings/${meetingId}`);
        await contributor.page.goto(`${APP_URL}/series/${seriesId}/meetings/${meetingId}`);

        await expect(owner.page.getByText("Live").first()).toBeVisible();
        await expect(contributor.page.getByText("Live").first()).toBeVisible();

        await contributor.page.getByLabel("Capture input").fill(issueTitle);
        await contributor.page.keyboard.press("Enter");

        await expect(contributor.page.getByText(issueTitle).first()).toBeVisible();
        await expect(owner.page.getByText(issueTitle).first()).toBeVisible();
      } finally {
        await owner.context.close();
        await contributor.context.close();
      }
    } finally {
      await rest(request, `meeting_series?id=eq.${seriesId}`, { method: "DELETE", headers: serviceHeaders("return=minimal") }).catch(() => undefined);
      await deleteAuthUser(request, participantId);
    }
  });

  test("meeting page relies on realtime, not a 2s polling timer", async ({
    browser,
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    const seriesId = await createSeries(request, orgId, `No-poll meeting ${Date.now()}`);
    const meetingId = await createMeeting(request, seriesId, "live");

    try {
      await addSeriesParticipant(request, seriesId, TEST_USER_ID, "owner");
      const { context, page } = await newAuthedPage(browser, request, TEST_USER_EMAIL);

      try {
        await page.goto(`${APP_URL}/series/${seriesId}/meetings/${meetingId}`);
        await expect(page.getByText("Live").first()).toBeVisible();

        // Let the initial load and any refetch-on-mount settle.
        await page.waitForTimeout(1500);

        // Count meeting refetches during a quiet, idle window. The removed
        // setInterval(refreshMeeting, 2000) fired roughly twice in 5s, each
        // invalidating the meeting detail and list queries, so the old code
        // produced several /rest/v1/meetings refetches here. Realtime is
        // event-driven, so an idle page must issue none.
        let meetingFetches = 0;
        const onRequest = (req: Request) => {
          if (req.url().includes("/rest/v1/meetings?select=")) meetingFetches += 1;
        };
        page.on("request", onRequest);
        await page.waitForTimeout(5000);
        page.off("request", onRequest);

        expect(meetingFetches).toBeLessThan(2);
      } finally {
        await context.close();
      }
    } finally {
      await rest(request, `meeting_series?id=eq.${seriesId}`, { method: "DELETE", headers: serviceHeaders("return=minimal") }).catch(() => undefined);
    }
  });
});
