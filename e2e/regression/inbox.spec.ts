import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const SEED_NOTIFICATION_UNREAD = [
  "70000000-0000-0000-0000-000000000001",
  "70000000-0000-0000-0000-000000000002",
  "70000000-0000-0000-0000-000000000005",
];

const SEED_NOTIFICATION_READ = [
  "70000000-0000-0000-0000-000000000003",
  "70000000-0000-0000-0000-000000000004",
];

// Reset seed notifications to original state: restore read flags and bump
// created_at so they appear at the top of the list regardless of how many
// test-created notifications exist in the DB.
async function resetSeedNotifications(request: Parameters<Parameters<typeof test>[2]>[0]["request"]) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  // Bump all seed notifications to now so they appear in any paginated fetch.
  const allIds = [...SEED_NOTIFICATION_UNREAD, ...SEED_NOTIFICATION_READ];
  await request.patch(
    `${SUPABASE_URL}/rest/v1/notifications?id=in.(${allIds.join(",")})`,
    { headers, data: { created_at: new Date().toISOString() } }
  );

  // Restore unread state for the unread seed notifications.
  await request.patch(
    `${SUPABASE_URL}/rest/v1/notifications?id=in.(${SEED_NOTIFICATION_UNREAD.join(",")})`,
    { headers, data: { read: false } }
  );
}

test.describe("Inbox Page", () => {
  test.beforeEach(async ({ request }) => {
    await resetSeedNotifications(request);
  });

  test("renders heading with unread count", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Inbox" }).first()
    ).toBeVisible();

    await expect(
      page.getByText(/unread notification/)
    ).toBeVisible({ timeout: 10000 });
  });

  test("mark all read button is visible when unread exist", async ({
    page,
  }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await expect(
      page.getByRole("button", { name: "Mark all read" })
    ).toBeVisible();
  });

  test("unread notifications are displayed", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await expect(
      page.getByText(
        "Set up staging environment monitoring changed to in progress"
      )
    ).toBeVisible();
    await expect(
      page.getByText(
        "You were assigned: Migrate CI from Jenkins to GitHub Actions"
      )
    ).toBeVisible();
    await expect(
      page.getByText("Pratik shared meeting notes with you")
    ).toBeVisible();
  });

  test("earlier divider separates read notifications", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await expect(page.getByText("Earlier")).toBeVisible();
  });

  test("read notifications are shown", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await expect(
      page.getByText("Platform Team Standup is starting now")
    ).toBeVisible();
    await expect(
      page.getByText("Brief ready for Product Review")
    ).toBeVisible();
  });

  test("clicking mark all read clears unread state", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await page.getByRole("button", { name: "Mark all read" }).click();

    await expect(
      page.getByRole("button", { name: "Mark all read" })
    ).not.toBeVisible({ timeout: 5000 });
  });
});
