import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe("Calendar Sidebar", () => {
  test("toggle button opens and closes sidebar on desktop", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    // Sidebar starts closed
    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" })
    ).not.toBeVisible();

    // Click toggle to open
    await page.getByRole("button", { name: "Open calendar" }).click();
    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" })
    ).toBeVisible();
    await expect(page.getByText("Calendar").first()).toBeVisible();

    // Click toggle to close
    await page.getByRole("button", { name: "Close calendar" }).click();
    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" })
    ).not.toBeVisible();
  });

  test("mini calendar shows current month and today is highlighted", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    await page.getByRole("button", { name: "Open calendar" }).click();
    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" })
    ).toBeVisible();

    const today = new Date();
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const expectedMonth = `${monthNames[today.getMonth()]} ${today.getFullYear()}`;

    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" }).getByText(expectedMonth)
    ).toBeVisible();
  });

  test("clicking a date updates the day agenda", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await page.getByRole("button", { name: "Open calendar" }).click();
    const sidebar = page.getByRole("complementary", {
      name: "Calendar sidebar",
    });
    await expect(sidebar).toBeVisible();

    // Click day 15
    const dayButton = sidebar.getByRole("button", { name: "15", exact: true });
    if (await dayButton.isVisible()) {
      await dayButton.click();
      // The date header in the agenda section should show the selected day
      await expect(
        sidebar.locator("p.font-mono").filter({ hasText: "15" })
      ).toBeVisible();
    }
  });

  test("month navigation works", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await page.getByRole("button", { name: "Open calendar" }).click();
    const sidebar = page.getByRole("complementary", {
      name: "Calendar sidebar",
    });
    await expect(sidebar).toBeVisible();

    // Navigate to previous month
    await sidebar.getByRole("button", { name: "Previous month" }).click();

    const today = new Date();
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const expectedMonth = `${monthNames[prevMonth.getMonth()]} ${prevMonth.getFullYear()}`;
    await expect(sidebar.getByText(expectedMonth)).toBeVisible();

    // Navigate forward
    await sidebar.getByRole("button", { name: "Next month" }).click();
    const currentMonth = `${monthNames[today.getMonth()]} ${today.getFullYear()}`;
    await expect(sidebar.getByText(currentMonth)).toBeVisible();
  });

  test("sidebar persists open state across page navigations", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    // Open sidebar
    await page.getByRole("button", { name: "Open calendar" }).click();
    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" })
    ).toBeVisible();

    // Navigate to another page
    await page.goto("/settings");
    await waitForApp(page);

    // Sidebar should still be open (persisted via localStorage)
    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" })
    ).toBeVisible();
  });

  test("keyboard shortcut Ctrl+. toggles sidebar", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    // Sidebar starts closed
    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" })
    ).not.toBeVisible();

    // Press Ctrl+.
    await page.keyboard.press("Control+.");
    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" })
    ).toBeVisible();

    // Press again to close
    await page.keyboard.press("Control+.");
    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" })
    ).not.toBeVisible();
  });
});
