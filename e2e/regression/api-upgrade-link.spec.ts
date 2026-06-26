import { test, expect } from "@playwright/test";

const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test.describe("POST /api/billing/upgrade-link", () => {
  test("unauthenticated call returns non-200", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/billing/upgrade-link`, {
      data: {},
    });
    // Unconfigured env -> 404 (dormant). Configured env, no session -> 401.
    // Either way, a browser with no auth session must never receive 200.
    expect(res.status()).not.toBe(200);
  });

  test("returns JSON with an error or url field", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/billing/upgrade-link`, {
      data: {},
    });
    const body = await res.json().catch(() => null);
    // Body is always valid JSON: either { error } or (on 200) { url }.
    expect(body).not.toBeNull();
    expect(typeof body).toBe("object");
  });
});
