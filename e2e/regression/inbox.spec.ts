import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe("Inbox Page", () => {
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
