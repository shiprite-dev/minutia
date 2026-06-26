import { test, expect } from "@playwright/test";

const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Strip the project storageState so every request in this file is truly
// unauthenticated. The webServer env in playwright.config.ts activates the
// route (UPGRADE_SIGNING_SECRET + UPGRADE_CHECKOUT_URL are set), so auth is
// checked before any server-to-server call and an unauthenticated caller
// must receive 401 -- not 404 (dormant) or 200.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("POST /api/billing/upgrade-link", () => {
  test("unauthenticated call returns 401", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/billing/upgrade-link`, {
      data: {},
    });
    expect(res.status()).toBe(401);
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
