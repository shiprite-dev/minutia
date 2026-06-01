import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const ONBOARDING_PASSWORD = "password123";

type OnboardingState = {
  userId: string;
  email: string;
  orgId: string;
  cookieValue: string;
};

function supabaseHeaders(prefer = "return=minimal") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function getSeedWorkspaceId() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}&select=current_organization_id`,
    { headers: supabaseHeaders("return=representation") }
  );
  expect(response.ok).toBeTruthy();

  const rows = await response.json();
  const orgId = rows[0]?.current_organization_id;
  expect(orgId).toBeTruthy();
  return orgId as string;
}

async function createOnboardingAuthState(): Promise<OnboardingState> {
  const userId = randomUUID();
  const email = `onboarding-${userId}@example.com`;
  const orgId = await getSeedWorkspaceId();
  const authHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  const invitation = await fetch(`${SUPABASE_URL}/rest/v1/organization_invitations`, {
    method: "POST",
    headers: supabaseHeaders(),
    body: JSON.stringify({
      organization_id: orgId,
      email,
      role: "member",
      status: "pending",
      invited_by: TEST_USER_ID,
    }),
  });
  expect(invitation.ok).toBeTruthy();

  const createUser = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      id: userId,
      email,
      password: ONBOARDING_PASSWORD,
      email_confirm: true,
      user_metadata: { name: "Test User" },
    }),
  });
  expect(createUser.ok).toBeTruthy();

  const profile = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: supabaseHeaders("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({
      id: userId,
      email,
      name: "Test User",
      has_completed_onboarding: false,
    }),
  });
  expect(profile.ok).toBeTruthy();

  const currentOrg = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=current_organization_id`,
    { headers: supabaseHeaders("return=representation") }
  );
  expect(currentOrg.ok).toBeTruthy();
  const currentOrgRows = await currentOrg.json();
  expect(currentOrgRows[0]?.current_organization_id).toBe(orgId);

  const token = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: ONBOARDING_PASSWORD,
    }),
  });
  expect(token.ok).toBeTruthy();

  const session = await token.json();

  return {
    userId,
    email,
    orgId,
    cookieValue: `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`,
  };
}

async function deleteOnboardingUser(state: OnboardingState) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/organization_invitations?organization_id=eq.${state.orgId}&email=eq.${state.email}`,
    { method: "DELETE", headers: supabaseHeaders() }
  );

  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${state.userId}`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
}

async function setOnboardingFlag(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  state: OnboardingState,
  value: boolean
) {
  const response = await request.patch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${state.userId}`,
    { headers: supabaseHeaders(), data: { has_completed_onboarding: value } }
  );
  expect(response.ok()).toBeTruthy();

  await expect
    .poll(async () => {
      const current = await request.get(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${state.userId}&select=has_completed_onboarding`,
        { headers: supabaseHeaders() }
      );
      expect(current.ok()).toBeTruthy();
      const rows = await current.json();
      return rows[0]?.has_completed_onboarding;
    })
    .toBe(value);
}

async function deleteOnboardingSeries(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  state: OnboardingState,
) {
  await request.delete(
    `${SUPABASE_URL}/rest/v1/meeting_series?owner_id=eq.${state.userId}`,
    { headers: supabaseHeaders() }
  );
}

test.describe("Onboarding wizard", () => {
  test.describe.configure({ mode: "serial" });
  let state: OnboardingState | null = null;

  test.beforeEach(async ({ page }) => {
    state = await createOnboardingAuthState();
    await page.context().addCookies([
      {
        name: "sb-127-auth-token",
        value: state.cookieValue,
        domain: new URL(APP_URL).hostname,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 60 * 60,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/dashboard", { waitUntil: "commit" });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText("Welcome to Minutia")).toBeVisible({ timeout: 15000 });
  });

  test.afterEach(async ({ request }) => {
    if (!state) return;
    await setOnboardingFlag(request, state, true);
    await deleteOnboardingSeries(request, state);
    await deleteOnboardingUser(state);
    state = null;
  });

  test("shows onboarding wizard for new users", async ({ page }) => {
    await expect(page.getByText("Welcome to Minutia")).toBeVisible();
    await expect(page.getByLabel("What should we call you?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(page.getByText("Skip setup")).toBeVisible();
  });

  test("step 1 pre-fills existing name", async ({ page }) => {
    const nameInput = page.getByLabel("What should we call you?");
    await expect(nameInput).toHaveValue("Test User");
  });

  test("continue button is disabled with empty name", async ({ page }) => {
    const nameInput = page.getByLabel("What should we call you?");
    await nameInput.clear();
    await expect(
      page.getByRole("button", { name: "Continue" })
    ).toBeDisabled();
  });

  test("step 1 advances to step 2 on Continue", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Create your first series")).toBeVisible();
    await expect(page.getByLabel("Meeting name")).toBeVisible();
    await expect(page.getByText("How often?")).toBeVisible();
  });

  test("step 2 has cadence pills and attendees field", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Weekly", { exact: true })).toBeVisible();
    await expect(page.getByText("Biweekly", { exact: true })).toBeVisible();
    await expect(page.getByText("Monthly", { exact: true })).toBeVisible();
    await expect(
      page.getByLabel("Attendees", { exact: false })
    ).toBeVisible();
  });

  test("step 2 create series is disabled without name", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("button", { name: "Create series" })
    ).toBeDisabled();
  });

  test("step 2 skip for now advances to step 3", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByText("You're all set")).toBeVisible();
  });

  test("step 3 shows feature tour items", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByText("OIL Board")).toBeVisible();
    await expect(page.getByText("Live Capture")).toBeVisible();
    await expect(page.getByText("Pre-Meeting Brief")).toBeVisible();
    await expect(page.getByText("Keyboard First")).toBeVisible();
  });

  test("skip setup goes directly to dashboard", async ({ page }) => {
    await page.getByText("Skip setup").click();
    await page.waitForURL("**/dashboard");
    await waitForApp(page);
    await expect(page.getByText("OIL Board")).toBeVisible();
    await expect(page.getByText("Outstanding items")).toBeVisible();
  });

  test("completing onboarding does not show wizard on next visit", async ({
    page,
  }) => {
    await page.getByText("Skip setup").click();
    await page.waitForURL("**/dashboard");
    await waitForApp(page);

    await page.reload();
    await waitForApp(page);
    await expect(page.getByText("Welcome to Minutia")).not.toBeVisible();
    await expect(page.getByText("Outstanding items")).toBeVisible();
  });

  test("full flow: name, create series, complete", async ({ page }) => {
    await expect(page.getByText("Welcome to Minutia")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Meeting name").fill("E2E Onboarding Series");
    await page.getByRole("button", { name: "Create series" }).click();

    await expect(page.getByText("You're all set")).toBeVisible();
    await page.getByRole("button", { name: "Start tracking" }).click();

    await page.waitForURL("**/series/**");
    await waitForApp(page);
    await expect(page.getByText("E2E Onboarding Series")).toBeVisible();
  });
});
