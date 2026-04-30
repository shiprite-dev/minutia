import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, waitForApp } from "./seed-data";

test.describe("Meeting Detail (Completed)", () => {
  const url = `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup2}`;

  test("renders completed meeting with all sections", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByText("Platform Team Standup").first()
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Platform Standup #2" })
    ).toBeVisible();

    await expect(page.getByText(/April 8, 2026/i)).toBeVisible();

    await expect(page.getByText("Alice").first()).toBeVisible();
    await expect(page.getByText("Bob").first()).toBeVisible();
    await expect(page.getByText("Carol").first()).toBeVisible();

    await expect(page.getByText(/Items raised/i).first()).toBeVisible();
    await expect(page.getByText(/Decisions/i).first()).toBeVisible();
    await expect(page.getByText("Notes").first()).toBeVisible();
  });

  test("decisions are displayed with rationale", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByText("Use GitHub Actions for CI/CD")
    ).toBeVisible();
  });

  test("notes textarea is editable", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEditable();
  });

  test("back link navigates to series detail", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await page
      .locator(`a[href="/series/${SERIES.platformStandup}"]`)
      .first()
      .click();
    await expect(page).toHaveURL(`/series/${SERIES.platformStandup}`);
  });
});

test.describe("Meeting Detail (Upcoming)", () => {
  const url = `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup4}`;

  test("renders upcoming meeting with brief and start button", async ({
    page,
  }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Platform Standup #4" })
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Start meeting" })
    ).toBeVisible();

    await expect(
      page.getByText("Brief", { exact: true }).first()
    ).toBeVisible();

    await expect(page.getByText("Attendees").first()).toBeVisible();
    await expect(page.getByText("Alice").first()).toBeVisible();
    await expect(page.getByText("Bob").first()).toBeVisible();
    await expect(page.getByText("Carol").first()).toBeVisible();
  });
});

test.describe("Meeting Detail (Retro)", () => {
  const url = `/series/${SERIES.incidentRetro}/meetings/${MEETINGS.retro}`;

  test("retro meeting renders with notes and issues", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: /Retro: API Outage/i })
    ).toBeVisible();

    await expect(page.getByText("Frank").first()).toBeVisible();
    await expect(page.getByText("Grace").first()).toBeVisible();

    await expect(page.getByText("Notes").first()).toBeVisible();
  });
});
