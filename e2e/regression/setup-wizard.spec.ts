import { test, expect } from "@playwright/test";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_URL = "http://localhost:3000";

function supabaseHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

// ---------------------------------------------------------------------------
// API tests (no browser needed, run in parallel)
// ---------------------------------------------------------------------------
test.describe("Setup API endpoints", () => {
  test.describe.configure({ mode: "parallel" });

  test("GET /api/setup/status returns setup status", async ({ request }) => {
    const res = await request.get(`${APP_URL}/api/setup/status`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("setup_completed");
    expect(body).toHaveProperty("has_admin");
    expect(typeof body.setup_completed).toBe("boolean");
    expect(typeof body.has_admin).toBe("boolean");
  });

  test("GET /api/setup/check-env returns environment validation", async ({
    request,
  }) => {
    const res = await request.get(`${APP_URL}/api/setup/check-env`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    expect(body).toHaveProperty("env");
    expect(body).toHaveProperty("db");
    expect(body).toHaveProperty("services");

    expect(body.env).toHaveProperty("jwt_secret");
    expect(body.env).toHaveProperty("anon_key");
    expect(body.env).toHaveProperty("service_role_key");
    expect(body.env).toHaveProperty("site_url");
    expect(body.env).toHaveProperty("smtp_configured");
    expect(body.env).toHaveProperty("ai_configured");

    expect(typeof body.db.connected).toBe("boolean");
    expect(typeof body.db.latency_ms).toBe("number");
  });

  test("POST /api/setup/create-admin rejects invalid input", async ({
    request,
  }) => {
    const res = await request.post(`${APP_URL}/api/setup/create-admin`, {
      data: { email: "not-an-email", password: "short", name: "" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("POST /api/setup/create-admin rejects missing fields", async ({
    request,
  }) => {
    const res = await request.post(`${APP_URL}/api/setup/create-admin`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/admin/smtp-test returns error when SMTP not configured", async ({
    request,
  }) => {
    const res = await request.post(`${APP_URL}/api/admin/smtp-test`, {
      data: { recipient_email: "test@example.com" },
    });
    const body = await res.json();
    expect(body).toHaveProperty("success");
    // Either returns success:false (no SMTP) or success:true (SMTP configured in env)
    expect(typeof body.success).toBe("boolean");
  });

  test("GET /api/admin/config returns config object", async ({ request }) => {
    const res = await request.get(`${APP_URL}/api/admin/config`);
    // May be 401/403 if setup is completed and no auth, or 200 during setup
    if (res.ok()) {
      const body = await res.json();
      expect(typeof body).toBe("object");
    }
  });

  test("PUT /api/admin/config rejects invalid JSON", async ({ request }) => {
    const res = await request.put(`${APP_URL}/api/admin/config`, {
      headers: { "Content-Type": "text/plain" },
      data: "not json",
    });
    // Should return 400 or 401
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("POST /api/setup/complete fails without admin user", async ({
    request,
  }) => {
    // First check if an admin exists
    const statusRes = await request.get(`${APP_URL}/api/setup/status`);
    const status = await statusRes.json();

    if (!status.has_admin) {
      const res = await request.post(`${APP_URL}/api/setup/complete`);
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("admin");
    }
  });
});

// ---------------------------------------------------------------------------
// UI tests (serial, since they mutate instance state)
// ---------------------------------------------------------------------------
test.describe("Setup wizard UI", () => {
  test.describe.configure({ mode: "serial" });

  test("setup page renders wizard or redirects to app when already set up", async ({ page }) => {
    await page.goto("/setup", { waitUntil: "networkidle" });

    // If setup is complete, page redirects to login or main app
    const setupHeading = page.getByText("Instance Setup");
    const loginForm = page.getByText("Sign in");
    const dashboard = page.getByText("Outstanding items");

    const isSetup = await setupHeading.isVisible().catch(() => false);
    const isLogin = await loginForm.isVisible().catch(() => false);
    const isDashboard = await dashboard.isVisible().catch(() => false);

    expect(isSetup || isLogin || isDashboard).toBeTruthy();
  });

  test("setup wizard step indicators include all 4 steps", async ({ page }) => {
    await page.goto("/setup", { waitUntil: "networkidle" });

    const isSetupPage = await page.getByText("Instance Setup").isVisible().catch(() => false);
    if (!isSetupPage) {
      test.skip();
      return;
    }

    await expect(page.getByText("Environment", { exact: true })).toBeVisible();
    await expect(page.getByText("Admin Account")).toBeVisible();
    await expect(page.getByText("Configure")).toBeVisible();
    await expect(page.getByText("Ready")).toBeVisible();
  });

  test("environment check displays service status rows", async ({ page }) => {
    await page.goto("/setup", { waitUntil: "networkidle" });

    const isSetupPage = await page.getByText("Instance Setup").isVisible().catch(() => false);
    if (!isSetupPage) {
      test.skip();
      return;
    }

    // Wait for env check API to return
    await expect(page.getByText("JWT Secret")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Anon Key")).toBeVisible();
    await expect(page.getByText("Database")).toBeVisible();
    await expect(page.getByText("Auth Service")).toBeVisible();
    await expect(page.getByText("REST API")).toBeVisible();
  });

  test("environment check shows optional services section", async ({ page }) => {
    await page.goto("/setup", { waitUntil: "networkidle" });

    const isSetupPage = await page.getByText("Instance Setup").isVisible().catch(() => false);
    if (!isSetupPage) {
      test.skip();
      return;
    }

    await expect(page.getByText("JWT Secret")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Optional services")).toBeVisible();
    await expect(page.getByText(/SMTP:/)).toBeVisible();
    await expect(page.getByText(/AI:/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Database schema tests (verify migration applied correctly)
// ---------------------------------------------------------------------------
test.describe("Admin schema (migration 00009)", () => {
  test.describe.configure({ mode: "parallel" });

  test("profiles table has role column", async ({ request }) => {
    if (!SERVICE_KEY) {
      test.skip();
      return;
    }

    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/profiles?select=role&limit=1`,
      { headers: supabaseHeaders() }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    if (data.length > 0) {
      expect(data[0]).toHaveProperty("role");
      expect(["user", "admin"]).toContain(data[0].role);
    }
  });

  test("instance_config table exists with seed data", async ({ request }) => {
    if (!SERVICE_KEY) {
      test.skip();
      return;
    }

    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/instance_config?select=key,value`,
      { headers: supabaseHeaders() }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    const keys = data.map((r: { key: string }) => r.key);
    expect(keys).toContain("instance_name");
    expect(keys).toContain("setup_completed");
    expect(keys).toContain("instance_id");
  });

  test("instance_config default values are correct", async ({ request }) => {
    if (!SERVICE_KEY) {
      test.skip();
      return;
    }

    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/instance_config?key=eq.instance_name&select=value`,
      { headers: supabaseHeaders() }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data[0]?.value).toBe("Minutia");
  });
});
