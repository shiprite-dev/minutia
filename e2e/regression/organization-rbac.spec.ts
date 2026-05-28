import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readOutbox, withOutbox } from "../helpers/outbox";

const APP_URL = "http://localhost:3000";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

function serviceHeaders(prefer = "return=minimal") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function getCurrentOrgId(request: APIRequestContext) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}&select=current_organization_id`,
    { headers: serviceHeaders() }
  );
  expect(res.ok()).toBeTruthy();
  const rows = await res.json();
  const orgId = rows[0]?.current_organization_id;
  expect(orgId).toBeTruthy();
  return orgId as string;
}

async function setGlobalRole(request: APIRequestContext, role: "admin" | "user") {
  const res = await request.patch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}`,
    { headers: serviceHeaders(), data: { role } }
  );
  expect(res.ok()).toBeTruthy();
}

async function upsertMembership(
  request: APIRequestContext,
  orgId: string,
  userId: string,
  role: "admin" | "member"
) {
  const res = await request.post(
    `${SUPABASE_URL}/rest/v1/organization_members?on_conflict=organization_id,user_id`,
    {
      headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
      data: { organization_id: orgId, user_id: userId, role },
    }
  );
  expect(res.ok()).toBeTruthy();
}

async function createAuthUser(
  request: APIRequestContext,
  email: string,
  userMetadata: Record<string, string> = {}
) {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: serviceHeaders(),
    data: {
      email,
      password: "password123",
      email_confirm: true,
      user_metadata: { name: email.split("@")[0], ...userMetadata },
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return (body.id ?? body.user?.id) as string;
}

async function deleteAuthUser(request: APIRequestContext, userId: string | null) {
  if (!userId) return;
  await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: serviceHeaders(),
  });
}

async function getPasswordAccessToken() {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(anonKey).toBeTruthy();

  const supabase = createClient(SUPABASE_URL, anonKey!);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: "test@example.com",
    password: "password123",
  });

  expect(error).toBeNull();
  expect(data.session?.access_token).toBeTruthy();
  return data.session!.access_token;
}

test.describe("Organization RBAC and workspace routes", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: "e2e/.auth/user.json" });

  test.beforeEach(async ({ request }) => {
    test.skip(!SERVICE_KEY, "Requires service role for RBAC setup");
    await setGlobalRole(request, "user");
  });

  test.afterEach(async ({ request }) => {
    if (!SERVICE_KEY) return;
    await setGlobalRole(request, "user");
  });

  test("organization admin can list workspace members and invitations", async ({
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    await upsertMembership(request, orgId, TEST_USER_ID, "admin");

    const res = await request.get(`${APP_URL}/api/admin/invitations`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.organization.id).toBe(orgId);
    expect(body.members.some((member: { user_id: string }) => member.user_id === TEST_USER_ID)).toBe(true);
  });

  test("organization invitation route rejects non-admin members", async ({
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    await upsertMembership(request, orgId, TEST_USER_ID, "member");

    const res = await request.get(`${APP_URL}/api/admin/invitations`);
    expect(res.status()).toBe(403);
  });

  test("organization admin can invite an existing user into the workspace", async ({
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    await upsertMembership(request, orgId, TEST_USER_ID, "admin");

    const invitedEmail = `org-invite-${Date.now()}@example.com`;
    const invitedUserId = await createAuthUser(request, invitedEmail);

    try {
      await withOutbox(async () => {
        const res = await request.post(`${APP_URL}/api/admin/invitations`, {
          data: { email: invitedEmail, role: "member" },
        });
        expect(res.ok()).toBeTruthy();

        const membershipRes = await request.get(
          `${SUPABASE_URL}/rest/v1/organization_members?organization_id=eq.${orgId}&user_id=eq.${invitedUserId}&select=role`,
          { headers: serviceHeaders() }
        );
        expect(membershipRes.ok()).toBeTruthy();
        const memberships = await membershipRes.json();
        expect(memberships[0]?.role).toBe("member");

        const invitationRes = await request.get(
          `${SUPABASE_URL}/rest/v1/organization_invitations?organization_id=eq.${orgId}&email=eq.${invitedEmail}&select=status,role`,
          { headers: serviceHeaders() }
        );
        expect(invitationRes.ok()).toBeTruthy();
        const invitations = await invitationRes.json();
        expect(invitations[0]).toMatchObject({ status: "accepted", role: "member" });

        const [email] = await readOutbox();
        expect(email.to).toBe(invitedEmail);
        expect(email.subject).toContain("Minutia");
        expect(email.text).toContain("member");
        expect(email.html).toContain("/settings");
      });
    } finally {
      await deleteAuthUser(request, invitedUserId);
    }
  });

  test("organization invitation route validates request body", async ({
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    await upsertMembership(request, orgId, TEST_USER_ID, "admin");

    const res = await request.post(`${APP_URL}/api/admin/invitations`, {
      data: { email: "not-an-email", role: "member" },
    });
    expect(res.status()).toBe(400);
  });

  test("self-host database rejects a second workspace", async ({ request }) => {
    const orgId = crypto.randomUUID();
    const res = await request.post(`${SUPABASE_URL}/rest/v1/organizations`, {
      headers: serviceHeaders(),
      data: {
        id: orgId,
        name: "Second Workspace",
        slug: `second-${Date.now()}`,
        created_by: TEST_USER_ID,
      },
    });

    if (res.ok()) {
      await request.delete(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}`, {
        headers: serviceHeaders(),
      });
    }

    expect(res.ok()).toBeFalsy();
  });

  test("pending invitation is accepted when user signs up outside invite link", async ({
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    await upsertMembership(request, orgId, TEST_USER_ID, "admin");

    const invitedEmail = `pending-invite-${Date.now()}@example.com`;
    let invitedUserId: string | null = null;

    const inviteRes = await request.post(
      `${SUPABASE_URL}/rest/v1/organization_invitations`,
      {
        headers: serviceHeaders(),
        data: {
          organization_id: orgId,
          email: invitedEmail,
          role: "member",
          status: "pending",
          invited_by: TEST_USER_ID,
        },
      }
    );
    expect(inviteRes.ok()).toBeTruthy();

    try {
      invitedUserId = await createAuthUser(request, invitedEmail);

      const membershipRes = await request.get(
        `${SUPABASE_URL}/rest/v1/organization_members?organization_id=eq.${orgId}&user_id=eq.${invitedUserId}&select=role`,
        { headers: serviceHeaders() }
      );
      expect(membershipRes.ok()).toBeTruthy();
      const memberships = await membershipRes.json();
      expect(memberships[0]?.role).toBe("member");

      const invitationRes = await request.get(
        `${SUPABASE_URL}/rest/v1/organization_invitations?organization_id=eq.${orgId}&email=eq.${invitedEmail}&select=status,accepted_by`,
        { headers: serviceHeaders() }
      );
      expect(invitationRes.ok()).toBeTruthy();
      const invitations = await invitationRes.json();
      expect(invitations[0]).toMatchObject({
        status: "accepted",
        accepted_by: invitedUserId,
      });
    } finally {
      await deleteAuthUser(request, invitedUserId);
      await request.delete(
        `${SUPABASE_URL}/rest/v1/organization_invitations?organization_id=eq.${orgId}&email=eq.${invitedEmail}`,
        { headers: serviceHeaders() }
      );
    }
  });

  test("signup metadata cannot grant organization admin access without an invitation", async ({
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    const forgedEmail = `forged-org-${Date.now()}@example.com`;
    let forgedUserId: string | null = null;

    try {
      forgedUserId = await createAuthUser(request, forgedEmail, {
        organization_id: orgId,
        organization_role: "admin",
      });

      const membershipRes = await request.get(
        `${SUPABASE_URL}/rest/v1/organization_members?organization_id=eq.${orgId}&user_id=eq.${forgedUserId}&select=role`,
        { headers: serviceHeaders() }
      );
      expect(membershipRes.ok()).toBeTruthy();
      const memberships = await membershipRes.json();
      expect(memberships).toEqual([]);

      const profileRes = await request.get(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${forgedUserId}&select=current_organization_id`,
        { headers: serviceHeaders() }
      );
      expect(profileRes.ok()).toBeTruthy();
      const profiles = await profileRes.json();
      expect(profiles[0]?.current_organization_id).toBeNull();
    } finally {
      await deleteAuthUser(request, forgedUserId);
    }
  });

  test("members cannot self-promote through profile updates", async ({
    request,
  }) => {
    const accessToken = await getPasswordAccessToken();
    const res = await request.patch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}`, {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      data: { role: "admin" },
    });

    expect(res.ok()).toBeFalsy();
  });

  test("settings exposes workspace invite UI to organization admins", async ({
    page,
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);
    await upsertMembership(request, orgId, TEST_USER_ID, "admin");

    await page.goto("/settings");
    await expect(page.getByText("Workspace access")).toBeVisible();
    await expect(page.getByPlaceholder("teammate@company.com")).toBeVisible();
  });

  test("sidebar shows the current workspace without a workspace switcher", async ({
    page,
    request,
  }) => {
    const orgId = await getCurrentOrgId(request);

    const orgRes = await request.get(
      `${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}&select=name`,
      { headers: serviceHeaders() }
    );
    expect(orgRes.ok()).toBeTruthy();
    const organizations = await orgRes.json();

    await page.goto("/settings");
    await expect(page.getByText(organizations[0].name)).toBeVisible();
    await expect(page.getByLabel("Organization")).toHaveCount(0);
  });
});
