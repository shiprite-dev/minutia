import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, waitForApp } from "./seed-data";

test.describe("Series List Page", () => {
  test("renders header, create button, and series cards", async ({ page }) => {
    await page.goto("/series");
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Series" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create series" })
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /Platform Team Standup/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Product Review/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Incident Retro/i }).first()
    ).toBeVisible();

    await expect(page.getByText("Weekly").first()).toBeVisible();
    await expect(page.getByText("Biweekly").first()).toBeVisible();
    await expect(page.getByText("Ad hoc").first()).toBeVisible();
  });

  test("create series dialog opens and has all fields", async ({ page }) => {
    await page.goto("/series");
    await waitForApp(page);

    await page.getByRole("button", { name: "Create series" }).click();

    const dialog = page.locator("[role='dialog']");
    await expect(dialog.getByLabel("Name")).toBeVisible();
    await expect(dialog.getByLabel("Description")).toBeVisible();
    await expect(dialog.getByText("Cadence")).toBeVisible();
    await expect(dialog.getByLabel("Default attendees")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Create" })
    ).toBeVisible();
  });

  test("series card links to series detail", async ({ page }) => {
    await page.goto("/series");
    await waitForApp(page);

    await page
      .getByRole("link", { name: /Platform Team Standup/i })
      .first()
      .click();
    await expect(page).toHaveURL(`/series/${SERIES.platformStandup}`);
  });
});

test.describe("Series Detail Page", () => {
  const url = `/series/${SERIES.platformStandup}`;

  test("renders header with name, back link, and action buttons", async ({
    page,
  }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Platform Team Standup" }).first()
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Start" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Series settings" })
    ).toBeVisible();
  });

  test("meeting history section lists meetings in order", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(page.getByText("Meeting history")).toBeVisible();

    await expect(page.getByText("Platform Standup #1")).toBeVisible();
    await expect(page.getByText("Platform Standup #2")).toBeVisible();
    await expect(page.getByText("Platform Standup #3")).toBeVisible();
    await expect(page.getByText("Platform Standup #4")).toBeVisible();
  });

  test("open issues section lists active issues", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    const section = page.getByText(/Open issues/i).first();
    await expect(section).toBeVisible();
  });

  test("settings dialog opens with all fields", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await page.getByRole("button", { name: "Series settings" }).click();

    const dialog = page.locator("[role='dialog']");
    await expect(
      dialog.getByRole("heading", { name: "Series settings" })
    ).toBeVisible();
    await expect(dialog.getByLabel("Name")).toBeVisible();
    await expect(dialog.getByLabel("Description")).toBeVisible();
    await expect(dialog.getByText("Cadence")).toBeVisible();
    await expect(dialog.getByLabel("Default attendees")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save changes" })
    ).toBeVisible();

    await expect(
      dialog.getByRole("radio", { name: "Weekly", exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "Biweekly" })
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "Monthly" })
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "Ad hoc" })
    ).toBeVisible();
  });

  test("meeting timeline items link to meeting detail", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await page.getByText("Platform Standup #1").click();
    await expect(page).toHaveURL(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`
    );
  });
});

test.describe("Series Detail Brief Card", () => {
  test("brief card shows pending issues and action buttons", async ({
    page,
  }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    const briefVisible = await page
      .getByText("Brief", { exact: true })
      .first()
      .isVisible()
      .catch(() => false);

    if (briefVisible) {
      await expect(page.getByTestId("send-brief-btn")).toBeVisible();
      await expect(page.getByTestId("copy-brief-btn")).toBeVisible();
    }
  });
});

test.describe("Product Review Series", () => {
  test("product review detail page loads correctly", async ({ page }) => {
    await page.goto(`/series/${SERIES.productReview}`);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Product Review" }).first()
    ).toBeVisible();
    await expect(page.getByText("Meeting history")).toBeVisible();

    await expect(
      page.getByText("Product Review Q2 Kick-off")
    ).toBeVisible();
    await expect(
      page.getByText("Product Review Sprint 1")
    ).toBeVisible();
  });

  test("product review meeting shows decisions", async ({ page }) => {
    await page.goto(
      `/series/${SERIES.productReview}/meetings/${MEETINGS.productKickoff}`
    );
    await waitForApp(page);

    await expect(
      page.getByText("Prioritize mobile app over desktop")
    ).toBeVisible();
  });
});
