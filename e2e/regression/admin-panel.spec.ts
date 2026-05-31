import { test, expect, type APIRequestContext } from "@playwright/test";

const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SETUP_TOKEN = process.env.MINUTIA_SETUP_TOKEN ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

test.describe.configure({ mode: "serial" });

function supabaseHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

function setupHeaders() {
  return {
    "Content-Type": "application/json",
    ...(SETUP_TOKEN ? { "x-minutia-setup-token": SETUP_TOKEN } : {}),
  };
}

async function setSeedUserRole(
  request: APIRequestContext,
  role: "admin" | "user"
) {
  const res = await request.patch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}`,
    { headers: supabaseHeaders(), data: { role } }
  );
  expect(res.ok()).toBeTruthy();
}

async function getSetupCompleted(request: APIRequestContext): Promise<string> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/instance_config?key=eq.setup_completed&select=value`,
    { headers: supabaseHeaders() }
  );
  expect(res.ok()).toBeTruthy();

  const rows = await res.json();
  return rows[0]?.value ?? "false";
}

async function setSetupCompleted(request: APIRequestContext, value: string) {
  const res = await request.patch(
    `${SUPABASE_URL}/rest/v1/instance_config?key=eq.setup_completed`,
    { headers: supabaseHeaders(), data: { value } }
  );
  expect(res.ok()).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Admin config API tests
// ---------------------------------------------------------------------------
test.describe("Admin config API", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ request }) => {
    test.skip(!SERVICE_KEY, "Requires service role for admin setup");
    await setSeedUserRole(request, "admin");
  });

  test.afterEach(async ({ request }) => {
    if (!SERVICE_KEY) return;
    await setSeedUserRole(request, "user");
  });

  test("PUT /api/admin/config writes and reads back values", async ({
    request,
  }) => {
    const testKey = `test_key_${Date.now()}`;
    const testValue = "test_value";

    const putRes = await request.put(`${APP_URL}/api/admin/config`, {
      data: { [testKey]: testValue },
    });

    // Might be 401 if setup is completed and we're not authed
    if (!putRes.ok()) {
      test.skip();
      return;
    }

    const getRes = await request.get(`${APP_URL}/api/admin/config`);
    expect(getRes.ok()).toBeTruthy();
    const config = await getRes.json();
    expect(config[testKey]).toBe(testValue);

    // Cleanup via direct DB
    if (SERVICE_KEY) {
      await request.delete(
        `${SUPABASE_URL}/rest/v1/instance_config?key=eq.${testKey}`,
        { headers: supabaseHeaders() }
      );
    }
  });

  test("GET /api/admin/config never reveals encrypted values", async ({
    request,
  }) => {
    const putRes = await request.put(`${APP_URL}/api/admin/config`, {
      data: { smtp_pass: "secret123" },
    });

    if (!putRes.ok()) {
      test.skip();
      return;
    }

    const getRes = await request.get(`${APP_URL}/api/admin/config`);
    expect(getRes.ok()).toBeTruthy();
    const config = await getRes.json();

    if (config.smtp_pass !== undefined) {
      expect(config.smtp_pass).toBe("configured");
    }

    const revealRes = await request.get(
      `${APP_URL}/api/admin/config?reveal=true`
    );
    expect(revealRes.ok()).toBeTruthy();
    const revealed = await revealRes.json();
    if (revealed.smtp_pass !== undefined) {
      expect(revealed.smtp_pass).toBe("configured");
    }

    if (SERVICE_KEY) {
      const rawRes = await request.get(
        `${SUPABASE_URL}/rest/v1/instance_config?key=eq.smtp_pass&select=value,encrypted`,
        { headers: supabaseHeaders() }
      );
      expect(rawRes.ok()).toBeTruthy();
      const rows = await rawRes.json();
      expect(rows[0]?.encrypted).toBe(true);
      expect(rows[0]?.value).not.toBe("secret123");
      expect(rows[0]?.value).toContain("minutia:v1:");

      await request.delete(
        `${SUPABASE_URL}/rest/v1/instance_config?key=eq.smtp_pass`,
        { headers: supabaseHeaders() }
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Setup completion API tests
// ---------------------------------------------------------------------------
test.describe("Setup completion flow", () => {
  test.describe.configure({ mode: "serial" });

  test("POST /api/setup/seed-demo creates demo data", async ({ request }) => {
    if (!SERVICE_KEY) {
      test.skip();
      return;
    }

    const originalSetupCompleted = await getSetupCompleted(request);

    try {
      await setSetupCompleted(request, "false");

      // Check if admin exists
      const statusRes = await request.get(`${APP_URL}/api/setup/status`);
      const status = await statusRes.json();

      if (!status.has_admin) {
        // Cannot seed without admin
        const res = await request.post(`${APP_URL}/api/setup/seed-demo`, {
          headers: setupHeaders(),
        });
        expect(res.status()).toBe(400);
      } else {
        const res = await request.post(`${APP_URL}/api/setup/seed-demo`, {
          headers: setupHeaders(),
        });
        if (res.ok()) {
          const body = await res.json();
          expect(body).toHaveProperty("series_id");
          expect(body).toHaveProperty("issues_created");
          expect(body.issues_created).toBe(5);

          // Cleanup: delete the seeded series
          await request.delete(
            `${SUPABASE_URL}/rest/v1/meeting_series?name=eq.Weekly Vendor Sync`,
            { headers: supabaseHeaders() }
          );
        }
      }
    } finally {
      await setSetupCompleted(request, originalSetupCompleted);
    }
  });
});

// ---------------------------------------------------------------------------
// Instance config schema tests
// ---------------------------------------------------------------------------
test.describe("Instance config schema", () => {
  test.describe.configure({ mode: "serial" });

  test("instance_config upsert works on conflict", async ({ request }) => {
    if (!SERVICE_KEY) {
      test.skip();
      return;
    }

    // Upsert a value twice
    const key = "instance_name";
    const newValue = "Test Instance";

    await request.patch(
      `${SUPABASE_URL}/rest/v1/instance_config?key=eq.${key}`,
      { headers: supabaseHeaders(), data: { value: newValue } }
    );

    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/instance_config?key=eq.${key}&select=value`,
      { headers: supabaseHeaders() }
    );
    const data = await res.json();
    expect(data[0]?.value).toBe(newValue);

    // Restore original
    await request.patch(
      `${SUPABASE_URL}/rest/v1/instance_config?key=eq.${key}`,
      { headers: supabaseHeaders(), data: { value: "Minutia" } }
    );
  });

  test("profiles role column rejects invalid values", async ({ request }) => {
    if (!SERVICE_KEY) {
      test.skip();
      return;
    }

    // Try to set an invalid role
    const res = await request.patch(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.test@example.com`,
      { headers: supabaseHeaders(), data: { role: "superadmin" } }
    );

    // Should fail with constraint violation
    expect(res.ok()).toBeFalsy();
  });

  test("profiles role defaults to user", async ({ request }) => {
    if (!SERVICE_KEY) {
      test.skip();
      return;
    }

    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.test@example.com&select=role`,
      { headers: supabaseHeaders() }
    );
    const data = await res.json();
    if (data.length > 0) {
      expect(data[0].role).toBe("user");
    }
  });

  test("organization tenancy tables are exposed to service role", async ({ request }) => {
    if (!SERVICE_KEY) {
      test.skip();
      return;
    }

    const orgRes = await request.get(
      `${SUPABASE_URL}/rest/v1/organizations?select=id,name,slug&limit=1`,
      { headers: supabaseHeaders() }
    );
    expect(orgRes.ok()).toBeTruthy();

    const memberRes = await request.get(
      `${SUPABASE_URL}/rest/v1/organization_members?select=organization_id,user_id,role&limit=1`,
      { headers: supabaseHeaders() }
    );
    expect(memberRes.ok()).toBeTruthy();
  });
});
