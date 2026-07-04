import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
} from "@playwright/test";
import { waitForApp } from "./seed-data";

// These tests flip the shared seed user's companion_last_seen_at back and
// forth; running them in parallel workers races that single profiles row.
// "default" mode runs the file's tests in order on one worker.
test.describe.configure({ mode: "default" });

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

const PROMPT_COPY =
  "For the best experience, download and install the companion app.";
const DOWNLOAD_URL =
  "https://github.com/shiprite-dev/minutia-desktop/releases/latest";

function serviceHeaders(prefer = "return=representation") {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this test");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
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
    headers: { ...serviceHeaders(), ...(options.headers ?? {}) },
  });
  expect(response.ok()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function setCompanionLastSeen(
  request: APIRequestContext,
  value: string | null
) {
  await rest(request, `profiles?id=eq.${TEST_USER_ID}`, {
    method: "PATCH",
    headers: serviceHeaders("return=minimal"),
    data: { companion_last_seen_at: value },
  });
}

async function createLiveMeetingFixture(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Companion handshake ${stamp}`,
      description: "Created by companion handshake coverage.",
      cadence: "weekly",
      default_attendees: ["Alice", "Bob"],
      owner_id: TEST_USER_ID,
    },
  });
  await rest(request, "meetings", {
    method: "POST",
    data: {
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: `Companion handshake session ${stamp}`,
      date: "2026-06-23",
      attendees: ["Alice", "Bob"],
      status: "live",
      notes_markdown: "",
      transcript_raw: null,
      completed_at: null,
    },
  });

  return { seriesId, meetingId };
}

async function deleteSeries(request: APIRequestContext, id: string) {
  await rest(request, `meeting_series?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

// pwRequest.newContext() inherits the project's storageState (the signed-in
// seed user), so a truly anonymous context must reset it explicitly.
async function anonContext() {
  return pwRequest.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  });
}

async function seedAccessToken(request: APIRequestContext) {
  const response = await request.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      data: { email: "test@example.com", password: "password123" },
    }
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()).access_token as string;
}

test.describe("companion handshake", () => {
  test.afterEach(async ({ request }) => {
    if (HAS_SERVICE_ROLE) await setCompanionLastSeen(request, null);
  });

  test("heartbeat: rejects anon, accepts Bearer, and clears the install prompt", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated fixtures");
    test.setTimeout(60_000);

    await setCompanionLastSeen(request, null);
    const fixture = await createLiveMeetingFixture(request);
    const anon = await anonContext();

    try {
      // Anonymous heartbeat is rejected.
      const unauth = await anon.post("/api/companion/heartbeat");
      expect(unauth.status()).toBe(401);

      // A valid Bearer token marks the companion alive.
      const token = await seedAccessToken(anon);
      const ok = await anon.post("/api/companion/heartbeat", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(ok.status()).toBe(200);
      expect(await ok.json()).toEqual({ ok: true });

      // With the companion checked in, the meeting page no longer nudges to install.
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);
      await expect(page.getByText("Live").first()).toBeVisible();
      await expect(page.getByText(PROMPT_COPY)).toHaveCount(0);
    } finally {
      await anon.dispose();
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("install prompt shows for a companion-less user and dismiss persists", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated fixtures");
    test.setTimeout(60_000);

    await setCompanionLastSeen(request, null);
    const fixture = await createLiveMeetingFixture(request);

    try {
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);
      await expect(page.getByText("Live").first()).toBeVisible();

      await expect(page.getByText(PROMPT_COPY)).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Download for macOS" })
      ).toHaveAttribute("href", DOWNLOAD_URL);

      // Dismiss hides it immediately.
      await page
        .getByRole("button", { name: "Dismiss companion app prompt" })
        .click();
      await expect(page.getByText(PROMPT_COPY)).toHaveCount(0);

      // The dismissal persists across a reload (localStorage).
      await page.reload();
      await waitForApp(page);
      await expect(page.getByText("Live").first()).toBeVisible();
      await expect(page.getByText(PROMPT_COPY)).toHaveCount(0);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("authorize page approves and mints a working desktop token", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    await page.goto("/companion/authorize?device=Test%20Mac");
    await waitForApp(page);
    await expect(
      page.getByText("Authorize the Minutia companion app on Test Mac?")
    ).toBeVisible();

    await page.getByRole("button", { name: "Approve" }).click();

    const openLink = page.getByRole("link", { name: "Open the Minutia app" });
    await expect(openLink).toBeVisible();
    const href = await openLink.getAttribute("href");
    expect(href).toMatch(/^minutia:\/\/auth-callback\?token_hash=/);

    const tokenHash = decodeURIComponent(
      new URL(href!).search.replace("?token_hash=", "")
    );
    expect(tokenHash.length).toBeGreaterThan(0);

    // Prove the token is real: run the exact GoTrue exchange the desktop app runs.
    const verify = await request.post(`${SUPABASE_URL}/auth/v1/verify`, {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      data: { type: "magiclink", token_hash: tokenHash },
    });
    expect(verify.ok()).toBeTruthy();
    const session = await verify.json();
    expect(typeof session.access_token).toBe("string");
    expect(session.access_token.length).toBeGreaterThan(0);
  });

  test("signed-out visit bounces to login and returns to the authorize page", async ({
    browser,
  }) => {
    test.setTimeout(60_000);

    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    try {
      await page.goto("/companion/authorize?device=Test%20Mac");
      await expect(page).toHaveURL(/\/login\?.*next=%2Fcompanion%2Fauthorize/);

      await page.getByLabel("Email address").fill("test@example.com");
      await page.getByLabel("Password").fill("password123");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();

      // The existing next/redirect handling returns to the authorize page with
      // the device query intact.
      await expect(
        page.getByText("Authorize the Minutia companion app on Test Mac?")
      ).toBeVisible({ timeout: 15_000 });
      const returned = new URL(page.url());
      expect(returned.pathname).toBe("/companion/authorize");
      expect(returned.searchParams.get("device")).toBe("Test Mac");
    } finally {
      await context.close();
    }
  });

  test("authorize POST rejects unauthenticated and Bearer-only callers", async () => {
    const anon = await anonContext();
    try {
      // Anonymous: no session at all.
      const unauth = await anon.post("/api/companion/authorize");
      expect(unauth.status()).toBe(401);

      // Bearer-only: a desktop/API client must not mint its own authorization.
      const token = await seedAccessToken(anon);
      const bearerOnly = await anon.post("/api/companion/authorize", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(bearerOnly.status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });
});
