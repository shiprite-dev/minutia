import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { readOutbox, withOutbox } from "../helpers/outbox";
import { waitForApp } from "./seed-data";

const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

function serviceHeaders(prefer = "return=representation") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function rest(
  request: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {},
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers ?? {}) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function currentOrgId(request: APIRequestContext) {
  const rows = await rest(
    request,
    `profiles?id=eq.${TEST_USER_ID}&select=current_organization_id`,
  );
  return rows[0].current_organization_id as string;
}

async function createSeries(request: APIRequestContext, attendees: string[]) {
  const id = randomUUID();
  const name = `Invite from series ${Date.now()}`;
  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id,
      name,
      description: "Created by series invite coverage.",
      cadence: "weekly",
      default_attendees: attendees,
      owner_id: TEST_USER_ID,
      organization_id: await currentOrgId(request),
    },
  });
  return { id, name };
}

async function profileIdByEmail(request: APIRequestContext, email: string) {
  const rows = await rest(
    request,
    `profiles?email=eq.${encodeURIComponent(email)}&select=id`,
  );
  return (rows[0]?.id ?? null) as string | null;
}

async function cleanup(
  request: APIRequestContext,
  seriesId: string,
  email: string,
) {
  await rest(request, `meeting_series?id=eq.${seriesId}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
  const userId = await profileIdByEmail(request, email);
  if (userId) {
    await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: serviceHeaders(),
    });
  }
  await rest(
    request,
    `organization_invitations?email=eq.${encodeURIComponent(email)}`,
    {
      method: "DELETE",
      headers: serviceHeaders("return=minimal"),
    },
  );
}

test.describe("Invite colleagues from a series", () => {
  test.describe.configure({ mode: "serial" });

  test("a series owner invites an attendee who accepts and lands in the workspace on that series", async ({
    page,
    browser,
    request,
  }) => {
    test.skip(!SERVICE_KEY, "Requires service role for invite fixtures");
    test.setTimeout(90_000);
    const colleague = `series-colleague-${Date.now()}@example.com`;
    const series = await createSeries(request, ["Alice", colleague]);
    const orgId = await currentOrgId(request);
    const inviteeContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });

    try {
      await withOutbox(async () => {
        await page.goto(`/series/${series.id}`);
        await waitForApp(page);
        await page.getByRole("button", { name: "Invite colleagues" }).click();

        const dialog = page.getByRole("dialog", { name: "Invite colleagues" });
        await expect(dialog.getByLabel("Invite by email")).toHaveValue(
          colleague,
        );
        await dialog
          .getByRole("button", { name: "Invite", exact: true })
          .click();
        await expect(dialog.getByText(/Invitation sent/)).toBeVisible();

        const inviteEmail = (await readOutbox()).find(
          (mail) => mail.to === colleague,
        );
        expect(inviteEmail).toBeTruthy();
        const acceptUrl = inviteEmail!.text.match(/https?:\/\/\S+/)?.[0];
        expect(acceptUrl).toContain("/auth/v1/verify");

        const invitee = await inviteeContext.newPage();
        await invitee.goto(acceptUrl!);
        await expect(invitee).toHaveURL(/\/accept-invite/);
        await invitee
          .getByLabel("Password", { exact: true })
          .fill("invite-password123");
        await invitee.getByLabel("Confirm password").fill("invite-password123");
        await invitee.getByRole("button", { name: "Set password" }).click();
        await expect(invitee).toHaveURL(`${APP_URL}/dashboard`);

        await waitForApp(invitee);
        await invitee
          .getByTestId("setup-screen")
          .getByRole("button", { name: "Skip" })
          .click();
        await expect(invitee.getByTestId("setup-screen")).toHaveCount(0);
        await invitee.goto("/series");
        await waitForApp(invitee);
        await invitee.getByText(series.name).first().click();
        await expect(invitee).toHaveURL(new RegExp(`/series/${series.id}$`));
        await expect(
          invitee.getByRole("heading", { name: series.name }),
        ).toBeVisible();
      });

      const inviteeId = await profileIdByEmail(request, colleague);
      const [profile] = await rest(
        request,
        `profiles?id=eq.${inviteeId}&select=current_organization_id`,
      );
      expect(profile.current_organization_id).toBe(orgId);
      const participants = await rest(
        request,
        `series_participants?series_id=eq.${series.id}&user_id=eq.${inviteeId}&select=role,invited_by`,
      );
      expect(participants).toEqual([
        { role: "participant", invited_by: TEST_USER_ID },
      ]);
    } finally {
      await inviteeContext.close();
      await cleanup(request, series.id, colleague);
    }
  });

  test("an inviter whose workspace cannot add members sees the upgrade state instead of a silent failure", async ({
    page,
    request,
  }) => {
    test.skip(!SERVICE_KEY, "Requires service role for invite fixtures");
    const colleague = `series-gated-${Date.now()}@example.com`;
    const series = await createSeries(request, [colleague]);
    const inviteBodies: Record<string, unknown>[] = [];

    try {
      await page.route("**/api/admin/invitations", (route) => {
        if (route.request().method() !== "POST") return route.continue();
        inviteBodies.push(route.request().postDataJSON());
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Inviting teammates requires an upgraded workspace.",
            code: "INVITE_UPGRADE_REQUIRED",
          }),
        });
      });

      await page.goto(`/series/${series.id}`);
      await waitForApp(page);
      await page.getByRole("button", { name: "Invite colleagues" }).click();

      const dialog = page.getByRole("dialog", { name: "Invite colleagues" });
      await dialog.getByRole("button", { name: "Invite", exact: true }).click();

      await expect(
        dialog.getByText(/Upgrade to invite teammates/),
      ).toBeVisible();
      await expect(dialog.getByLabel("Invite by email")).toHaveCount(0);
      await expect(dialog.getByText(/Invitation sent/)).toHaveCount(0);
      expect(inviteBodies).toEqual([
        { email: colleague, role: "member", series_id: series.id },
      ]);
    } finally {
      await cleanup(request, series.id, colleague);
    }
  });
});
