import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readOutbox, withOutbox } from "../helpers/outbox";
import { MEETINGS, SHARE_TOKENS, waitForApp } from "./seed-data";

const APP_URL = "http://localhost:3000";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_USER_EMAIL = "test@example.com";

function anonHeaders() {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

function serviceHeaders(prefer = "return=minimal") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function getShareOrgId(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/guest_shares?token=eq.${SHARE_TOKENS.meeting}&select=organization_id`,
    { headers: serviceHeaders() }
  );
  expect(res.ok()).toBeTruthy();
  const rows = await res.json();
  const orgId = rows[0]?.organization_id;
  expect(orgId).toBeTruthy();
  return orgId as string;
}

async function setOrganizationRole(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  organizationId: string,
  userId: string,
  role: "admin" | "member"
) {
  const res = await request.post(
    `${SUPABASE_URL}/rest/v1/organization_members?on_conflict=organization_id,user_id`,
    {
      headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
      data: { organization_id: organizationId, user_id: userId, role },
    }
  );
  expect(res.ok()).toBeTruthy();
}

async function createGlobalAdmin(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  email: string
) {
  const userId = randomUUID();
  const createUser = await request.post(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: serviceHeaders(),
    data: {
      id: userId,
      email,
      password: "password123",
      email_confirm: true,
      user_metadata: { name: "Global Admin" },
    },
  });
  expect(createUser.ok()).toBeTruthy();

  const profile = await request.patch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
    { headers: serviceHeaders(), data: { role: "admin" } }
  );
  expect(profile.ok()).toBeTruthy();
  return userId;
}

async function deleteAuthUser(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  userId: string | null
) {
  if (!userId) return;
  await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: serviceHeaders(),
  });
}

test.describe("Guest Share Pages", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("meeting share renders public view", async ({ page }) => {
    await page.goto(`/share/${SHARE_TOKENS.meeting}`);
    await waitForApp(page);

    await expect(page.getByText(/view-only link/)).toBeVisible();
    await expect(page.getByText("minutia").first()).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Platform Standup #2" })
    ).toBeVisible();

    await expect(page.getByText("Alice").first()).toBeVisible();

    await expect(
      page.getByRole("link", { name: /Star on GitHub/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Try Minutia/i })
    ).toBeVisible();
  });

  test("series share renders public view with open issues", async ({
    page,
  }) => {
    await page.goto(`/share/${SHARE_TOKENS.series}`);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Platform Team Standup" })
    ).toBeVisible();
    await expect(page.getByText(/Open issues/).first()).toBeVisible();
    await expect(page.getByText(/Recent meetings/).first()).toBeVisible();
  });

  test("issue share renders public view with timeline", async ({ page }) => {
    await page.goto(`/share/${SHARE_TOKENS.issue}`);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", {
        name: "Migrate CI from Jenkins to GitHub Actions",
      })
    ).toBeVisible();
    await expect(page.getByText("Action").first()).toBeVisible();
    await expect(page.getByText("High").first()).toBeVisible();
    await expect(page.getByText("Timeline").first()).toBeVisible();
  });

  test("expired share shows expiry error", async ({ page }) => {
    await page.goto(`/share/${SHARE_TOKENS.expired}`);
    await waitForApp(page);

    await expect(page.getByText("Share link expired")).toBeVisible();
    await expect(
      page.getByText("This share link has expired.")
    ).toBeVisible();
  });

  test("invalid share token shows error", async ({ page }) => {
    await page.goto("/share/totally-invalid-token-xyz");
    await waitForApp(page);

    await expect(page.getByText("Invalid share link")).toBeVisible();
  });

  test("anonymous REST clients cannot enumerate guest share tokens", async ({
    request,
  }) => {
    test.skip(!ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required");

    const response = await request.get(
      `${SUPABASE_URL}/rest/v1/guest_shares?select=token,resource_type`,
      { headers: anonHeaders() }
    );

    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toEqual([]);
  });

  test("anonymous token lookup and shared resource access stay scoped", async ({
    request,
  }) => {
    test.skip(!ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required");

    const lookup = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/get_guest_share_by_token`,
      {
        headers: anonHeaders(),
        data: { share_token: SHARE_TOKENS.meeting },
      }
    );
    expect(lookup.ok()).toBeTruthy();
    await expect(lookup.json()).resolves.toEqual([
      expect.objectContaining({
        token: SHARE_TOKENS.meeting,
        resource_type: "meeting",
      }),
    ]);

    const invalidLookup = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/get_guest_share_by_token`,
      {
        headers: anonHeaders(),
        data: { share_token: "not-a-real-share-token" },
      }
    );
    expect(invalidLookup.ok()).toBeTruthy();
    await expect(invalidLookup.json()).resolves.toEqual([]);

    const payload = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/get_guest_share_payload`,
      {
        headers: anonHeaders(),
        data: { share_token: SHARE_TOKENS.meeting },
      }
    );
    expect(payload.ok()).toBeTruthy();
    await expect(payload.json()).resolves.toEqual(
      expect.objectContaining({
        resource_type: "meeting",
        meeting: expect.objectContaining({ id: MEETINGS.standup2 }),
      })
    );

    const sharedMeeting = await request.get(
      `${SUPABASE_URL}/rest/v1/meetings?id=eq.${MEETINGS.standup2}&select=id`,
      { headers: anonHeaders() }
    );
    expect(sharedMeeting.ok()).toBeTruthy();
    await expect(sharedMeeting.json()).resolves.toEqual([]);

    const privateMeeting = await request.get(
      `${SUPABASE_URL}/rest/v1/meetings?id=eq.${MEETINGS.productKickoff}&select=id`,
      { headers: anonHeaders() }
    );
    expect(privateMeeting.ok()).toBeTruthy();
    await expect(privateMeeting.json()).resolves.toEqual([]);
  });

  test("share access requests notify organization admins instead of global admins", async ({
    request,
  }) => {
    test.skip(!SERVICE_KEY, "Requires service role for org setup");

    const orgId = await getShareOrgId(request);
    const globalAdminEmail = `global-admin-${Date.now()}@example.com`;
    let globalAdminId: string | null = null;

    try {
      await setOrganizationRole(request, orgId, TEST_USER_ID, "admin");
      globalAdminId = await createGlobalAdmin(request, globalAdminEmail);
      await withOutbox(async () => {
        const res = await request.post(`${APP_URL}/api/invite-requests`, {
          data: {
            email: "viewer@example.com",
            next: `/share/${SHARE_TOKENS.meeting}`,
          },
        });
        expect(res.ok()).toBeTruthy();

        const [email] = await readOutbox();
        expect(email.to).toEqual([TEST_USER_EMAIL]);
        expect(email.to).not.toContain(globalAdminEmail);
        expect(email.replyTo).toBe("viewer@example.com");
        expect(email.text).toContain(`/share/${SHARE_TOKENS.meeting}`);
      });
    } finally {
      await setOrganizationRole(request, orgId, TEST_USER_ID, "member");
      await deleteAuthUser(request, globalAdminId);
    }
  });
});
