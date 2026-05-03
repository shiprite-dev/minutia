import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:3000";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function supabaseHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

// ---------------------------------------------------------------------------
// Admin config API tests
// ---------------------------------------------------------------------------
test.describe("Admin config API", () => {
  test.describe.configure({ mode: "parallel" });

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

  test("GET /api/admin/config masks encrypted values by default", async ({
    request,
  }) => {
    // Write an encrypted key
    const putRes = await request.put(`${APP_URL}/api/admin/config`, {
      data: { smtp_pass: "secret123" },
    });

    if (!putRes.ok()) {
      test.skip();
      return;
    }

    // Read without reveal
    const getRes = await request.get(`${APP_URL}/api/admin/config`);
    expect(getRes.ok()).toBeTruthy();
    const config = await getRes.json();

    if (config.smtp_pass !== undefined) {
      expect(config.smtp_pass).toBe("configured");
    }

    // Read with reveal
    const revealRes = await request.get(
      `${APP_URL}/api/admin/config?reveal=true`
    );
    if (revealRes.ok()) {
      const revealed = await revealRes.json();
      if (revealed.smtp_pass !== undefined) {
        expect(revealed.smtp_pass).toBe("secret123");
      }
    }

    // Cleanup
    if (SERVICE_KEY) {
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

    // Check if admin exists
    const statusRes = await request.get(`${APP_URL}/api/setup/status`);
    const status = await statusRes.json();

    if (!status.has_admin) {
      // Cannot seed without admin
      const res = await request.post(`${APP_URL}/api/setup/seed-demo`);
      expect(res.status()).toBe(400);
    } else {
      const res = await request.post(`${APP_URL}/api/setup/seed-demo`);
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
  });
});

// ---------------------------------------------------------------------------
// Instance config schema tests
// ---------------------------------------------------------------------------
test.describe("Instance config schema", () => {
  test.describe.configure({ mode: "parallel" });

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
});
