import { test, expect } from "@playwright/test";
import { MEETINGS, SHARE_TOKENS, waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function anonHeaders() {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    "Content-Type": "application/json",
  };
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

  test("anonymous token lookup and shared resource RLS stay scoped", async ({
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

    const sharedMeeting = await request.get(
      `${SUPABASE_URL}/rest/v1/meetings?id=eq.${MEETINGS.standup2}&select=id`,
      { headers: anonHeaders() }
    );
    expect(sharedMeeting.ok()).toBeTruthy();
    await expect(sharedMeeting.json()).resolves.toEqual([
      { id: MEETINGS.standup2 },
    ]);

    const privateMeeting = await request.get(
      `${SUPABASE_URL}/rest/v1/meetings?id=eq.${MEETINGS.productKickoff}&select=id`,
      { headers: anonHeaders() }
    );
    expect(privateMeeting.ok()).toBeTruthy();
    await expect(privateMeeting.json()).resolves.toEqual([]);
  });
});
