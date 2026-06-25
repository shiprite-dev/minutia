import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";

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

async function setSeedUserRole(request: APIRequestContext, role: "admin" | "user") {
  const res = await request.patch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}`,
    { headers: supabaseHeaders(), data: { role } }
  );
  expect(res.ok()).toBeTruthy();
}

let originalRole = "user";

test.describe("Admin - Workspace members", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test.beforeAll(async ({ request }) => {
    test.skip(!SERVICE_KEY, "Requires service role to flip seed user role");
    originalRole = await getSeedUserRole(request);
    await setSeedUserRole(request, "admin");
  });

  test.afterAll(async ({ request }) => {
    if (!SERVICE_KEY) return;
    await setSeedUserRole(request, originalRole === "admin" ? "admin" : "user");
  });

  test("workspace access region renders with invite controls", async ({ page }) => {
    await page.goto("/admin/users");
    await waitForApp(page);

    const region = page.getByRole("region", { name: /workspace access/i });
    await expect(region).toBeVisible();
    await expect(region.getByText(/Invite teammates/i)).toBeVisible();

    await expect(page.getByLabel("Invite by email")).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: /invitation role/i })
    ).toBeVisible();
  });

  test("members list shows at least one member with role controls", async ({ page }) => {
    await page.goto("/admin/users");
    await waitForApp(page);

    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();

    // Each member row exposes a per-member role select named "Role for <email>".
    const roleSelectors = page.getByRole("combobox", { name: /Role for/i });
    await expect(roleSelectors.first()).toBeVisible();
    expect(await roleSelectors.count()).toBeGreaterThan(0);

    // The current admin appears in the list, flagged as "You".
    await expect(page.getByText("You").first()).toBeVisible();
  });

  test("pending invitations section is present", async ({ page }) => {
    await page.goto("/admin/users");
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Pending invitations" })
    ).toBeVisible();
  });

  test("current user cannot remove themselves", async ({ page }) => {
    await page.goto("/admin/users");
    await waitForApp(page);

    const youBadge = page.getByText("You").first();
    await expect(youBadge).toBeVisible();
    const removeButton = youBadge
      .locator("xpath=ancestor::div[contains(@class,'grid')]")
      .getByRole("button", { name: /remove/i });
    await expect(removeButton).toBeDisabled();
  });
});
