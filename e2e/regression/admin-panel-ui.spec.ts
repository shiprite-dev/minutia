import { test, expect, type APIRequestContext } from "@playwright/test";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
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

async function getSeedUserRole(request: APIRequestContext): Promise<string> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}&select=role`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body[0]?.role ?? "user";
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

let originalRole = "user";

test.beforeAll(async ({ request }) => {
  test.skip(!SERVICE_KEY, "Requires service role to flip seed user role");
  originalRole = await getSeedUserRole(request);
});

test.afterAll(async ({ request }) => {
  if (!SERVICE_KEY) return;
  await setSeedUserRole(request, originalRole === "admin" ? "admin" : "user");
});

test.describe("Admin panel UI", () => {
  test("overview shows KPI cards with real counts", async ({ request, page }) => {
    await setSeedUserRole(request, "admin");

    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Admin", level: 1 })
    ).toBeVisible();

    // Each KPI card renders its label and a numeric count in the same card.
    for (const label of ["Users", "Series", "Meetings", "Open issues"]) {
      const card = page
        .locator('[data-slot="card-content"]', { hasText: label })
        .first();
      await expect(card).toBeVisible();
      await expect(card).toContainText(/\d/);
    }

    await expect(page.getByText(/Instance/)).toBeVisible();
    await expect(page.getByText(/Version/)).toBeVisible();
  });

  test("sidebar Admin link is visible and navigates", async ({
    request,
    page,
  }) => {
    await setSeedUserRole(request, "admin");

    await page.goto("/");
    const adminLink = page.getByRole("link", { name: "Admin" });
    await expect(adminLink).toBeVisible();
    await adminLink.click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: "Admin", level: 1 })
    ).toBeVisible();
  });

  test("health page lists database service as ok", async ({
    request,
    page,
  }) => {
    await setSeedUserRole(request, "admin");

    await page.goto("/admin/health");
    const dbRow = page.getByRole("listitem").filter({ hasText: "database" });
    await expect(dbRow).toBeVisible();
    await expect(dbRow).toContainText(/ok/i);
  });

  test("org admin without the instance role lands on workspace users", async ({
    request,
    page,
  }) => {
    await setSeedUserRole(request, "user");

    await page.goto("/admin");
    await page.waitForURL((url) => url.pathname === "/admin/users");
    await page.goto("/admin/settings");
    await page.waitForURL((url) => url.pathname === "/admin/users");
  });
});
