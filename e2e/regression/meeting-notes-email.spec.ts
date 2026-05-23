import { test, expect } from "@playwright/test";
import { ISSUES, MEETINGS, SERIES, waitForApp } from "./seed-data";

test.describe("Meeting notes email", () => {
  test("completed meeting can send branded notes", async ({ page }) => {
    await page.route(`**/api/meetings/${MEETINGS.standup2}/send-notes`, async (route) => {
      const body = route.request().postDataJSON() as { recipients?: string[] };
      expect(body.recipients).toEqual(["attendee@example.com"]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sent: 1 }),
      });
    });

    await page.goto(`/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup2}`);
    await waitForApp(page);

    await page.getByRole("button", { name: "Send notes" }).click();
    await page.getByLabel("Recipients").fill("attendee@example.com");
    await page.getByRole("button", { name: /^Send$/ }).click();

    await expect(page.getByText("Sent to 1 recipient.")).toBeVisible();
  });
});

test.describe("Issue email links", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated issue links preserve next path on login", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);

    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fissues%2F${ISSUES.migrateCI}`));
    await expect(page.getByRole("button", { name: "Request invite" })).toBeDisabled();
  });
});
