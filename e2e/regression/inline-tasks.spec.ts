import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, waitForApp } from "./seed-data";

const MEETING_URL = `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`;

test.describe("Inline Tasks", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(MEETING_URL);
    await waitForApp(page);
  });

  test("renders inline task items with checkboxes", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Items raised/ })
    ).toBeVisible();

    // Checkboxes should be present
    const checkboxes = page.getByRole("button", {
      name: /Mark (complete|incomplete)/,
    });
    await expect(checkboxes.first()).toBeVisible();
  });

  test("inline task items show issue keys", async ({ page }) => {
    await expect(page.getByLabel(/Issue key OIL-/).first()).toBeVisible();
  });

  test("resolved items show checked checkbox and strikethrough", async ({
    page,
  }) => {
    // "Fix flaky integration tests" is resolved in seed data
    const resolvedItem = page.getByText("Fix flaky integration tests").first();
    await expect(resolvedItem).toBeVisible();

    // The checkbox next to it should say "Mark incomplete"
    const row = resolvedItem.locator("..");
    await expect(
      row.locator("..").getByRole("button", { name: "Mark incomplete" })
    ).toBeVisible();
  });

  test("category pills are shown with correct labels", async ({ page }) => {
    await expect(page.getByText("Action").first()).toBeVisible();
    await expect(page.getByText("Decision").first()).toBeVisible();
  });

  test("assignee chips are shown", async ({ page }) => {
    await expect(page.getByText("Test User").first()).toBeVisible();
  });

  test("assignee picker includes Google Workspace Directory matches", async ({
    page,
  }) => {
    await page.route("**/api/workspace/directory?q=mina", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          people: [
            {
              resourceName: "people/c123",
              name: "Mina Director",
              email: "mina@example.com",
              organization: "Product",
            },
          ],
        }),
      });
    });

    await page
      .getByRole("button", { name: /^(?:[A-Z] .+|Assign)$/ })
      .first()
      .click();
    await page.getByPlaceholder("Search people...").fill("mina");

    const directoryMatch = page.getByRole("button", {
      name: /Assign Mina Director mina@example.com/,
    });
    await expect(directoryMatch).toBeVisible();
    await directoryMatch.click();

    await expect(page.getByText("mina@example.com").first()).toBeVisible();
  });

  test("clicking checkbox toggles issue status", async ({ page }) => {
    // Find an unchecked item and mark it complete
    const markComplete = page
      .getByRole("button", { name: "Mark complete" })
      .first();

    if (await markComplete.isVisible()) {
      await markComplete.click();

      // Should now show "Mark incomplete"
      await expect(
        page.getByRole("button", { name: "Mark incomplete" }).first()
      ).toBeVisible();
    }
  });

  test("Add item button reveals inline input", async ({ page }) => {
    await page.getByRole("button", { name: "Add item" }).click();

    await expect(
      page.getByPlaceholder("Type item title, press Enter...")
    ).toBeVisible();
  });

  test("adding inline item creates new issue in the list", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Add item" }).click();

    const input = page.getByPlaceholder("Type item title, press Enter...");
    await input.fill("E2E test inline item");
    await input.press("Enter");

    // New item should appear in the list
    await expect(
      page.getByText("E2E test inline item").first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("inline add input supports Enter to submit and stays open for next item", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Add item" }).click();

    const input = page.getByPlaceholder("Type item title, press Enter...");
    await input.fill("First inline item");
    await input.press("Enter");

    await expect(
      page.getByText("First inline item").first()
    ).toBeVisible({ timeout: 5000 });

    // Input should still be visible for the next item
    await expect(input).toBeVisible();
  });

  test("double-clicking title enters edit mode", async ({ page }) => {
    const title = page.getByText("Fix flaky integration tests").first();
    await title.dblclick();

    await expect(page.locator("input[type='text']").first()).toBeVisible();
  });
});
