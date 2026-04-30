import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe("My Actions Page", () => {
  test("renders heading and summary counts", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "My Actions" }).first()
    ).toBeVisible();

    await expect(page.getByText(/OPEN/).first()).toBeVisible();
  });

  test("needs attention section shows open/in_progress issues owned by user", async ({
    page,
  }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.getByText("Needs attention").first()
    ).toBeVisible();

    await expect(
      page.getByText("Migrate CI from Jenkins to GitHub Actions").first()
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Set up staging environment monitoring").first()
    ).toBeVisible();
    await expect(
      page.getByText("Write user research summary for Q2 features").first()
    ).toBeVisible();
  });

  test("pending section shows pending issues", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.locator("button").filter({ hasText: "Pending" }).first()
    ).toBeVisible();
    await expect(
      page.getByText("Evaluate Kubernetes vs ECS for new services")
    ).toBeVisible();
  });

  test("completed section is collapsed by default", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.locator("button").filter({ hasText: "Completed" }).first()
    ).toBeVisible();

    await expect(
      page.getByText("Fix flaky integration tests")
    ).not.toBeVisible();
  });

  test("completed section expands on click", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await page
      .locator("button")
      .filter({ hasText: "Completed" })
      .first()
      .click();
    await expect(
      page.getByText("Fix flaky integration tests")
    ).toBeVisible();
  });

  test("issues not owned by user are excluded", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.getByText("Update API rate limiting config")
    ).not.toBeVisible();

    await expect(
      page.getByText("Increase DB connection pool size")
    ).not.toBeVisible();
  });

  test("series tag overlays are visible on issue cards", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await expect(
      page.getByText("Platform Team Standup").first()
    ).toBeVisible();
  });
});
