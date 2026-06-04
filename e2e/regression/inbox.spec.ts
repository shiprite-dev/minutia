import { test, expect } from "@playwright/test";
import { resetSeedNotifications, waitForApp } from "./seed-data";

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

  test("has correct document title", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await expect(page).toHaveTitle(/Inbox/);
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

  test("marking individual notification as read updates count", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await expect(page.getByText("3 unread notifications")).toBeVisible();

    const markReadPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/rest/v1/notifications")
    );

    await page
      .getByText("Set up staging environment monitoring changed to in progress")
      .click();
    await markReadPromise;
    await expect(page).toHaveURL(/\/issues\/30000000-0000-0000-0000-000000000002/);

    await page.goBack();
    await waitForApp(page);
    await expect(page.getByText("2 unread notifications")).toBeVisible();
  });

  test("notification links navigate to relevant pages", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await page
      .getByText("You were assigned: Migrate CI from Jenkins to GitHub Actions")
      .click();
    await page.waitForLoadState("networkidle");

    expect(page.url()).toMatch(
      /\/issues\/30000000-0000-0000-0000-000000000001/
    );
  });
});
