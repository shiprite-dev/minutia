import { test, expect } from "@playwright/test";
import { ISSUES, waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

async function resetOwner(issueId: string, ownerName: string) {
  if (!SERVICE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/issues?id=eq.${issueId}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ owner_name: ownerName, owner_user_id: null }),
  });
}

// Read back the persisted owner columns so we can assert the actual acceptance
// criterion: assigning a workspace member links a real user FK (owner_user_id),
// while a free-text name does not. Returns null when no service key is present.
async function fetchOwner(
  issueId: string
): Promise<{ owner_user_id: string | null; owner_name: string } | null> {
  if (!SERVICE_KEY) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/issues?id=eq.${issueId}&select=owner_user_id,owner_name`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

test.describe("Issue assignment", () => {
  test.describe.configure({ mode: "serial" });

  test.afterEach(async () => {
    await resetOwner(ISSUES.headcount, "Dana");
    await resetOwner(ISSUES.graphql, "Carol");
  });

  test("assigns a workspace member and persists across reload", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.headcount}`);
    await waitForApp(page);

    await expect(page.getByRole("button", { name: "Assign owner" }).first()).toContainText(
      /Dana/
    );

    await page.getByRole("button", { name: "Assign owner" }).first().click();
    await page.getByPlaceholder("Search people...").fill("test");

    const memberOption = page.getByRole("option", { name: /Test User/ });
    await expect(memberOption).toBeVisible();
    await memberOption.click();

    await expect(page.getByRole("button", { name: "Assign owner" }).first()).toContainText(
      /Test User/
    );

    await page.reload();
    await waitForApp(page);
    await expect(page.getByRole("button", { name: "Assign owner" }).first()).toContainText(
      /Test User/
    );

    // The point of the feature: a workspace member is linked by user FK, not
    // just a display name (this is what drives notifications + My Actions).
    const owner = await fetchOwner(ISSUES.headcount);
    if (owner) expect(owner.owner_user_id).not.toBeNull();
  });

  test("assigns to a free-text name and persists across reload", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.graphql}`);
    await waitForApp(page);

    await expect(page.getByRole("button", { name: "Assign owner" }).first()).toContainText(
      /Carol/
    );

    await page.getByRole("button", { name: "Assign owner" }).first().click();
    await page.getByPlaceholder("Search people...").fill("Alex External");

    const freeTextOption = page.getByRole("option", {
      name: /Assign to "Alex External"/,
    });
    await expect(freeTextOption).toBeVisible();
    await freeTextOption.click();

    await expect(page.getByRole("button", { name: "Assign owner" }).first()).toContainText(
      /Alex External/
    );

    await page.reload();
    await waitForApp(page);
    await expect(page.getByRole("button", { name: "Assign owner" }).first()).toContainText(
      /Alex External/
    );

    // Free-text names do not link a user account.
    const owner = await fetchOwner(ISSUES.graphql);
    if (owner) {
      expect(owner.owner_user_id).toBeNull();
      expect(owner.owner_name).toBe("Alex External");
    }
  });
});
