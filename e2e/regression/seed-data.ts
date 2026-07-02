import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const SERIES = {
  platformStandup: "10000000-0000-0000-0000-000000000001",
  productReview: "10000000-0000-0000-0000-000000000002",
  incidentRetro: "10000000-0000-0000-0000-000000000003",
};

export const MEETINGS = {
  standup1: "20000000-0000-0000-0000-000000000001",
  standup2: "20000000-0000-0000-0000-000000000002",
  standup3: "20000000-0000-0000-0000-000000000003",
  standup4: "20000000-0000-0000-0000-000000000004",
  productKickoff: "20000000-0000-0000-0000-000000000010",
  productSprint1: "20000000-0000-0000-0000-000000000011",
  retro: "20000000-0000-0000-0000-000000000020",
};

export const ISSUES = {
  migrateCI: "30000000-0000-0000-0000-000000000001",
  stagingMonitoring: "30000000-0000-0000-0000-000000000002",
  userResearch: "30000000-0000-0000-0000-000000000003",
  evalK8s: "30000000-0000-0000-0000-000000000004",
  flakyTests: "30000000-0000-0000-0000-000000000005",
  rateLimiting: "30000000-0000-0000-0000-000000000006",
  dbPool: "30000000-0000-0000-0000-000000000007",
  sslCert: "30000000-0000-0000-0000-000000000008",
  headcount: "30000000-0000-0000-0000-000000000009",
  graphql: "30000000-0000-0000-0000-000000000010",
};

export const SHARE_TOKENS = {
  meeting: "test-share-meeting-abc123",
  series: "test-share-series-def456",
  issue: "test-share-issue-ghi789",
  expired: "test-share-expired-xyz000",
};

export const SEED_NOTIFICATION_UNREAD = [
  "70000000-0000-0000-0000-000000000001",
  "70000000-0000-0000-0000-000000000002",
  "70000000-0000-0000-0000-000000000005",
];

export const SEED_NOTIFICATION_READ = [
  "70000000-0000-0000-0000-000000000003",
  "70000000-0000-0000-0000-000000000004",
];

export async function resetSeedNotifications(request: APIRequestContext) {
  const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  const allIds = [...SEED_NOTIFICATION_UNREAD, ...SEED_NOTIFICATION_READ];

  // Hermetic reset: delete any notifications created by other tests in this
  // shard (assignments/status changes fire notify_* triggers). Without this the
  // inbox unread count drifts above the seed baseline and count assertions fail.
  await request.delete(
    `${supabaseUrl}/rest/v1/notifications?id=not.in.(${allIds.join(",")})`,
    { headers }
  );

  await request.patch(
    `${supabaseUrl}/rest/v1/notifications?id=in.(${allIds.join(",")})`,
    { headers, data: { created_at: new Date().toISOString() } }
  );

  await request.patch(
    `${supabaseUrl}/rest/v1/notifications?id=in.(${SEED_NOTIFICATION_UNREAD.join(",")})`,
    { headers, data: { read: false } }
  );
}

export async function waitForApp(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("body").waitFor({ state: "visible" });
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(() => {
            const shell = document.querySelector("[data-minutia-app-shell]");
            return !shell || shell.getAttribute("data-hydrated") === "true";
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Execution context was destroyed")
          ) {
            return false;
          }
          throw error;
        }
      },
      { timeout: 30_000 }
    )
    .toBe(true);
}
