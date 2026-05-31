import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { test, expect, type APIRequestContext } from "@playwright/test";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_USER_EMAIL = "test@example.com";
const TEST_USER_PASSWORD = "password123";
const TEST_SERIES_ID = "10000000-0000-0000-0000-000000000001";
const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const SETUP_TOKEN = process.env.MINUTIA_SETUP_TOKEN ?? "";

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function serviceHeaders(prefer = "return=minimal") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

function userHeaders(accessToken: string, prefer = "return=representation") {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

function setupHeaders(token = SETUP_TOKEN) {
  return {
    "Content-Type": "application/json",
    ...(token ? { "x-minutia-setup-token": token } : {}),
  };
}

async function signInAsSeedUser(request: APIRequestContext): Promise<string> {
  const res = await request.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: {
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      data: {
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
      },
    }
  );

  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.access_token).toBeTruthy();
  return body.access_token as string;
}

async function getSeedUserRole(request: APIRequestContext): Promise<string> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}&select=role`,
    { headers: serviceHeaders("return=representation") }
  );

  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body[0]?.role;
}

async function getSeedWorkspaceId(request: APIRequestContext): Promise<string> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}&select=current_organization_id`,
    { headers: serviceHeaders("return=representation") }
  );

  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body[0]?.current_organization_id).toBeTruthy();
  return body[0].current_organization_id as string;
}

async function getSetupCompleted(request: APIRequestContext): Promise<string> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/instance_config?key=eq.setup_completed&select=value`,
    { headers: serviceHeaders("return=representation") }
  );

  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body[0]?.value ?? "false";
}

async function setSetupCompleted(request: APIRequestContext, value: string) {
  const res = await request.patch(
    `${SUPABASE_URL}/rest/v1/instance_config?key=eq.setup_completed`,
    { headers: serviceHeaders(), data: { value } }
  );

  expect(res.ok()).toBeTruthy();
}

test.describe("Profile role API security", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ request }) => {
    test.skip(!ANON_KEY || !SERVICE_KEY, "Supabase anon and service keys are required");

    const res = await request.patch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}`,
      {
        headers: serviceHeaders(),
        data: { role: "user", name: "Test User" },
      }
    );

    expect(res.ok()).toBeTruthy();
  });

  test.afterEach(async ({ request }) => {
    if (!SERVICE_KEY) return;

    await request.patch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}`, {
      headers: serviceHeaders(),
      data: { role: "user", name: "Test User" },
    });
  });

  test("authenticated users cannot update their own role", async ({ request }) => {
    const accessToken = await signInAsSeedUser(request);

    const escalation = await request.patch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}`,
      {
        headers: userHeaders(accessToken),
        data: { role: "admin" },
      }
    );

    expect(escalation.ok()).toBeFalsy();
    await expect.poll(() => getSeedUserRole(request)).toBe("user");
  });

  test("authenticated users can still update safe profile fields", async ({
    request,
  }) => {
    const accessToken = await signInAsSeedUser(request);
    const nextName = `Test User ${Date.now()}`;

    const update = await request.patch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}&select=name,role`,
      {
        headers: userHeaders(accessToken),
        data: { name: nextName },
      }
    );

    expect(update.ok()).toBeTruthy();
    const body = await update.json();
    expect(body[0]).toMatchObject({ name: nextName, role: "user" });
  });
});

test.describe("Guest share API security", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(() => {
    test.skip(!ANON_KEY || !SERVICE_KEY, "Supabase anon and service keys are required");
  });

  test("workspace members can create shares for resources owned by another member", async ({
    request,
  }) => {
    const admin = serviceClient();
    const email = `foreign-owner-${Date.now()}@example.com`;
    const seriesId = crypto.randomUUID();
    const orgId = await getSeedWorkspaceId(request);

    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: TEST_USER_PASSWORD,
      email_confirm: true,
      user_metadata: { name: "Foreign Owner" },
    });
    expect(userError).toBeNull();
    expect(userData.user?.id).toBeTruthy();

    const foreignUserId = userData.user!.id;
    const { error: profileError } = await admin.from("profiles").upsert({
      id: foreignUserId,
      email,
      name: "Foreign Owner",
    });
    expect(profileError).toBeNull();

    const { error: seriesError } = await admin.from("meeting_series").insert({
      id: seriesId,
      name: "Foreign Private Series",
      owner_id: foreignUserId,
      organization_id: orgId,
    });
    expect(seriesError).toBeNull();

    try {
      const accessToken = await signInAsSeedUser(request);
      const response = await request.post(
        `${SUPABASE_URL}/rest/v1/guest_shares?select=id`,
        {
          headers: userHeaders(accessToken),
          data: {
            token: crypto.randomUUID(),
            resource_type: "series",
            resource_id: seriesId,
            permissions: "view",
            created_by: TEST_USER_ID,
          },
        }
      );

      expect(response.ok()).toBeTruthy();

      const verify = await request.get(
        `${SUPABASE_URL}/rest/v1/guest_shares?resource_id=eq.${seriesId}&select=resource_id`,
        { headers: serviceHeaders("return=representation") }
      );
      expect(verify.ok()).toBeTruthy();
      await expect(verify.json()).resolves.toEqual([{ resource_id: seriesId }]);
    } finally {
      await admin.from("guest_shares").delete().eq("resource_id", seriesId);
      await admin.auth.admin.deleteUser(foreignUserId);
    }
  });

  test("authenticated users can create shares for resources they own", async ({
    request,
  }) => {
    const accessToken = await signInAsSeedUser(request);
    const token = crypto.randomUUID();
    const orgId = await getSeedWorkspaceId(request);

    try {
      const response = await request.post(
        `${SUPABASE_URL}/rest/v1/guest_shares?select=token,resource_type,resource_id,organization_id`,
        {
          headers: userHeaders(accessToken),
          data: {
            token,
            resource_type: "series",
            resource_id: TEST_SERIES_ID,
            organization_id: crypto.randomUUID(),
            permissions: "view",
            created_by: TEST_USER_ID,
          },
        }
      );

      expect(response.ok()).toBeTruthy();
      await expect(response.json()).resolves.toEqual([
        {
          token,
          resource_type: "series",
          resource_id: TEST_SERIES_ID,
          organization_id: orgId,
        },
      ]);
    } finally {
      await request.delete(`${SUPABASE_URL}/rest/v1/guest_shares?token=eq.${token}`, {
        headers: userHeaders(accessToken),
      });
    }
  });
});

test.describe("Setup API security", () => {
  test.describe.configure({ mode: "serial" });

  test("credential probe paths return 404 instead of auth redirects", async ({
    playwright,
  }) => {
    const publicRequest = await playwright.request.newContext();
    for (const path of [
      "/.env",
      "/.env.production",
      "/credentials.json",
      "/keyfile.json",
      "/appsettings.json",
      "/account.json",
      "/api/env",
      "/actuator/env",
      "/cdn-cgi/scripts/test.js",
    ]) {
      const res = await publicRequest.get(`${APP_URL}${path}`, { maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
    }
    await publicRequest.dispose();
  });

  test("setup environment check is not public after setup", async ({
    request,
    playwright,
  }) => {
    const statusRes = await request.get(`${APP_URL}/api/setup/status`);
    expect(statusRes.ok()).toBeTruthy();
    const status = await statusRes.json();

    const publicRequest = await playwright.request.newContext();
    const res = await publicRequest.get(`${APP_URL}/api/setup/check-env`);
    if (status.setup_completed) {
      expect([401, 403]).toContain(res.status());
    } else if (SETUP_TOKEN) {
      expect(res.status()).toBe(403);
    } else {
      expect(res.ok()).toBeTruthy();
    }
    await publicRequest.dispose();
  });

  test("setup mutations require the bootstrap token when configured", async ({
    request,
  }) => {
    test.skip(!SETUP_TOKEN, "MINUTIA_SETUP_TOKEN is required");

    const body = { email: "not-an-email", password: "short", name: "" };

    const missingToken = await request.post(`${APP_URL}/api/setup/create-admin`, {
      data: body,
    });
    expect(missingToken.status()).toBe(403);

    const wrongToken = await request.post(`${APP_URL}/api/setup/create-admin`, {
      headers: setupHeaders("wrong-token"),
      data: body,
    });
    expect(wrongToken.status()).toBe(403);

    const validToken = await request.post(`${APP_URL}/api/setup/create-admin`, {
      headers: setupHeaders(),
      data: body,
    });
    expect(validToken.status()).toBe(400);
  });

  test("setup bootstrap mutations reject after setup is complete", async ({
    request,
  }) => {
    test.skip(!SERVICE_KEY, "Service role key is required");

    const originalSetupCompleted = await getSetupCompleted(request);
    const email = `blocked-setup-${Date.now()}@example.com`;

    try {
      await setSetupCompleted(request, "true");

      const createAdmin = await request.post(`${APP_URL}/api/setup/create-admin`, {
        headers: setupHeaders(),
        data: {
          email,
          password: "password123",
          name: "Blocked Setup User",
        },
      });
      expect(createAdmin.status()).toBe(409);
      await expect(createAdmin.json()).resolves.toMatchObject({
        error: "Setup is already complete",
      });

      const seedDemo = await request.post(`${APP_URL}/api/setup/seed-demo`, {
        headers: setupHeaders(),
      });
      expect(seedDemo.status()).toBe(409);
      await expect(seedDemo.json()).resolves.toMatchObject({
        error: "Setup is already complete",
      });

      const profileLookup = await request.get(
        `${SUPABASE_URL}/rest/v1/profiles?email=eq.${email}&select=id`,
        { headers: serviceHeaders("return=representation") }
      );
      expect(profileLookup.ok()).toBeTruthy();
      const profiles = await profileLookup.json();
      expect(profiles[0]?.id ?? null).toBeNull();
    } finally {
      await setSetupCompleted(request, originalSetupCompleted);
      const cleanupLookup = await request.get(
        `${SUPABASE_URL}/rest/v1/profiles?email=eq.${email}&select=id`,
        { headers: serviceHeaders("return=representation") }
      );
      const cleanupProfiles = cleanupLookup.ok() ? await cleanupLookup.json() : [];
      const createdUserId = cleanupProfiles[0]?.id ?? null;
      if (createdUserId) {
        await serviceClient().auth.admin.deleteUser(createdUserId);
      }
    }
  });
});
