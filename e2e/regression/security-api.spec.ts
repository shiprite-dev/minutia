import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { test, expect, type APIRequestContext } from "@playwright/test";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_USER_EMAIL = "test@example.com";
const TEST_USER_PASSWORD = "password123";
const TEST_SERIES_ID = "10000000-0000-0000-0000-000000000001";
const APP_URL = "http://localhost:3000";
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

    try {
      const response = await request.post(
        `${SUPABASE_URL}/rest/v1/guest_shares?select=token,resource_type,resource_id`,
        {
          headers: userHeaders(accessToken),
          data: {
            token,
            resource_type: "series",
            resource_id: TEST_SERIES_ID,
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
});
