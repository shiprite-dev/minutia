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
  });
});
