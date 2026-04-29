import { test, expect } from "@playwright/test";

test.describe("Inbox", () => {
  test("displays unread and read notifications", async ({ page }) => {
    await page.goto("/inbox");

    await expect(page.getByRole("heading", { name: "Inbox" }).first()).toBeVisible();
    await expect(page.getByText("unread notification")).toBeVisible();

    // Unread notifications
    await expect(page.getByText("Set up staging environment monitoring changed to in progress")).toBeVisible();
    await expect(page.getByText("You were assigned: Migrate CI")).toBeVisible();
    await expect(page.getByText("Pratik shared meeting notes with you")).toBeVisible();

    // Earlier separator and read notifications
    await expect(page.getByText("Earlier")).toBeVisible();
    await expect(page.getByText("Platform Team Standup is starting now")).toBeVisible();
    await expect(page.getByText("Brief ready for Product Review")).toBeVisible();
  });

  test("sidebar shows unread badge count", async ({ page }) => {
    await page.goto("/inbox");
    const inboxLink = page.locator('a[href="/inbox"]');
    await expect(inboxLink).toContainText("3");
  });

  test("clicking notification navigates to target", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByText("You were assigned: Migrate CI").click();
    await page.waitForURL(/\/issues\//);
    expect(page.url()).toContain("/issues/");
  });

  test("mark all read clears unread count", async ({ page }) => {
    await page.goto("/inbox");
    await page.getByRole("button", { name: "Mark all read" }).click();

    // Wait for the sidebar count to update
    const inboxLink = page.locator('a[href="/inbox"]');
    await expect(inboxLink).not.toContainText("3", { timeout: 5000 });
  });
});
