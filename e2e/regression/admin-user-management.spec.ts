import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

test.describe.configure({ mode: "serial" });

function serviceHeaders(prefer = "return=minimal") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function getSeedOrganizationId(request: APIRequestContext) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}&select=current_organization_id`,
    { headers: serviceHeaders("return=representation") }
  );
  expect(res.ok()).toBeTruthy();
  const rows = await res.json();
  const organizationId = rows[0]?.current_organization_id;
  expect(organizationId).toBeTruthy();
  return organizationId as string;
}

async function setSeedProfileRole(
  request: APIRequestContext,
  role: "admin" | "user"
) {
  const res = await request.patch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}`,
    { headers: serviceHeaders(), data: { role } }
  );
  expect(res.ok()).toBeTruthy();
}

async function setSeedOrgRole(
  request: APIRequestContext,
  organizationId: string,
  role: "admin" | "member"
) {
  const res = await request.post(
    `${SUPABASE_URL}/rest/v1/organization_members?on_conflict=organization_id,user_id`,
    {
      headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
      data: { organization_id: organizationId, user_id: TEST_USER_ID, role },
    }
  );
  expect(res.ok()).toBeTruthy();
}

async function createAuthUser(
  request: APIRequestContext,
  email: string,
  name: string
) {
  const userId = randomUUID();
  const createUser = await request.post(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: serviceHeaders(),
    data: {
      id: userId,
      email,
      password: "password123",
      email_confirm: true,
      user_metadata: { name },
    },
  });
  expect(createUser.ok()).toBeTruthy();
  return userId;
}

async function upsertMembership(
  request: APIRequestContext,
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

async function upsertInvitation(
  request: APIRequestContext,
  organizationId: string,
  email: string,
  role: "admin" | "member"
) {
  const res = await request.post(
    `${SUPABASE_URL}/rest/v1/organization_invitations?on_conflict=organization_id,email`,
    {
      headers: serviceHeaders("resolution=merge-duplicates,return=minimal"),
      data: {
        organization_id: organizationId,
        email,
        role,
        status: "pending",
        invited_by: TEST_USER_ID,
        accepted_by: null,
        accepted_at: null,
      },
    }
  );
  expect(res.ok()).toBeTruthy();
}

async function deleteAuthUser(request: APIRequestContext, userId: string | null) {
  if (!userId) return;
  await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: serviceHeaders(),
  });
}

async function deleteInvitation(
  request: APIRequestContext,
  organizationId: string | null,
  email: string | null
) {
  if (!organizationId || !email) return;
  await request.delete(
    `${SUPABASE_URL}/rest/v1/organization_invitations?organization_id=eq.${organizationId}&email=eq.${encodeURIComponent(email)}`,
    { headers: serviceHeaders() }
  );
}

async function newAnonymousApi() {
  return playwrightRequest.newContext({
    baseURL: APP_URL,
    storageState: { cookies: [], origins: [] },
  });
}

test.describe("Admin user management", () => {
  let organizationId: string | null = null;
  let memberId: string | null = null;
  let memberEmail: string | null = null;
  let inviteEmail: string | null = null;

  test.beforeEach(async ({ request }) => {
    test.skip(!SERVICE_KEY, "Requires service role for org setup");

    organizationId = await getSeedOrganizationId(request);
    await setSeedOrgRole(request, organizationId, "admin");
    await setSeedProfileRole(request, "admin");

    const suffix = `${Date.now()}-${Math.round(Math.random() * 10000)}`;
    memberEmail = `demo-member-${suffix}@example.com`;
    inviteEmail = `demo-invite-${suffix}@example.com`;

    memberId = await createAuthUser(request, memberEmail, "Demo Member");
    await upsertMembership(request, organizationId, memberId, "member");
    await upsertInvitation(request, organizationId, inviteEmail, "member");
  });

  test.afterEach(async ({ request }) => {
    if (organizationId && inviteEmail) {
      await deleteInvitation(request, organizationId, inviteEmail);
    }
    await deleteAuthUser(request, memberId);
    if (organizationId) {
      await setSeedOrgRole(request, organizationId, "member");
    }
    await setSeedProfileRole(request, "user");
  });

  test("workspace admins can scan members and pending invitations", async ({ page }) => {
    await page.goto("/admin/users");
    await waitForApp(page);

    const workspace = page.getByRole("region", { name: "Workspace access" });
    await expect(workspace).toBeVisible();
    await expect(workspace.getByText(/\d+ members/)).toBeVisible();
    await expect(workspace.getByText(/\d+ pending/)).toBeVisible();
    await expect(workspace.getByLabel("Invite by email")).toBeVisible();

    const inviteRole = workspace.getByRole("combobox", { name: "Invitation role" });
    await expect(inviteRole).toBeVisible();
    await expect(inviteRole).toHaveAttribute("data-slot", "select-trigger");

    await expect(workspace.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(workspace.getByText(memberEmail!)).toBeVisible();
    await expect(
      workspace.getByRole("combobox", { name: `Role for ${memberEmail}` })
    ).toBeVisible();

    await expect(workspace.getByText("Pending invitations")).toBeVisible();
    await expect(workspace.getByText(inviteEmail!)).toBeVisible();
    await expect(
      workspace.getByRole("button", { name: `Revoke invitation for ${inviteEmail}` })
    ).toBeVisible();
  });

  test("workspace admins can update member roles and revoke pending invitations", async ({
    page,
    request,
  }) => {
    await page.goto("/admin/users");
    await waitForApp(page);

    const workspace = page.getByRole("region", { name: "Workspace access" });
    await workspace.getByRole("combobox", { name: `Role for ${memberEmail}` }).click();
    await page.getByRole("option", { name: "Admin" }).click();
    await expect(workspace.getByText(`${memberEmail} is now an admin.`)).toBeVisible();

    const memberRes = await request.get(
      `${SUPABASE_URL}/rest/v1/organization_members?organization_id=eq.${organizationId}&user_id=eq.${memberId}&select=role`,
      { headers: serviceHeaders("return=representation") }
    );
    expect(memberRes.ok()).toBeTruthy();
    const members = await memberRes.json();
    expect(members[0]?.role).toBe("admin");

    await workspace
      .getByRole("button", { name: `Revoke invitation for ${inviteEmail}` })
      .click();
    await expect(workspace.getByText("Invitation revoked.")).toBeVisible();
    await expect(workspace.getByText(inviteEmail!)).not.toBeVisible();

    const inviteRes = await request.get(
      `${SUPABASE_URL}/rest/v1/organization_invitations?organization_id=eq.${organizationId}&email=eq.${encodeURIComponent(inviteEmail!)}&select=status`,
      { headers: serviceHeaders("return=representation") }
    );
    expect(inviteRes.ok()).toBeTruthy();
    const invitations = await inviteRes.json();
    expect(invitations[0]?.status).toBe("revoked");

    await workspace
      .getByRole("button", { name: `Remove ${memberEmail} from workspace` })
      .click();
    await expect(workspace.getByText(`${memberEmail} was removed.`)).toBeVisible();
    await expect(
      workspace.getByRole("button", { name: `Remove ${memberEmail} from workspace` })
    ).toHaveCount(0);

    const removedMemberRes = await request.get(
      `${SUPABASE_URL}/rest/v1/organization_members?organization_id=eq.${organizationId}&user_id=eq.${memberId}&select=role`,
      { headers: serviceHeaders("return=representation") }
    );
    expect(removedMemberRes.ok()).toBeTruthy();
    expect(await removedMemberRes.json()).toEqual([]);
  });
});

test.describe("Admin user management security", () => {
  test("member deletion accepts proxied same-origin requests before auth", async () => {
    const api = await newAnonymousApi();

    const res = await api.delete("/api/admin/members", {
      headers: {
        Origin: "https://workspace.example.com",
        "X-Forwarded-Host": "workspace.example.com",
        "X-Forwarded-Proto": "https",
        "Content-Type": "application/json",
      },
      data: { userId: randomUUID() },
    });
    const body = await res.json();

    await api.dispose();

    expect(res.status()).toBe(401);
    expect(body).toEqual({ error: "Not authenticated" });
  });

  test("member mutation rejects cross-origin requests before auth", async () => {
    const api = await newAnonymousApi();
    const res = await api.patch("/api/admin/members", {
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      data: { userId: randomUUID(), role: "admin" },
    });
    const body = await res.json();

    await api.dispose();

    expect(res.status()).toBe(403);
    expect(body).toEqual({ error: "Cross-origin requests are not allowed" });
  });

  test("invitation revoke rejects cross-origin requests before auth", async () => {
    const api = await newAnonymousApi();
    const res = await api.delete("/api/admin/invitations", {
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      data: { id: randomUUID() },
    });
    const body = await res.json();

    await api.dispose();

    expect(res.status()).toBe(403);
    expect(body).toEqual({ error: "Cross-origin requests are not allowed" });
  });
});
