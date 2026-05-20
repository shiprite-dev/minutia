import { test, expect, type APIRequestContext } from "@playwright/test";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_USER_EMAIL = "test@example.com";
const TEST_USER_PASSWORD = "password123";

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
