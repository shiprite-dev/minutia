import { test, expect } from "@playwright/test";
import { SERIES, ISSUES, waitForApp } from "./seed-data";

test.describe("Data Integrity", () => {
  test("dashboard open count is a positive number", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const heroNumber = page.locator(
      ".font-display.text-5xl.font-bold.text-ink"
    );
    await expect(heroNumber).toBeVisible();
    const count = await heroNumber.textContent();
    expect(Number(count)).toBeGreaterThanOrEqual(1);
  });

  test("series list shows 3 series from seed data", async ({ page }) => {
    await page.goto("/series");
    await waitForApp(page);

    await expect(
      page.getByRole("link", { name: /Platform Team Standup/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Product Review/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Incident Retro/i }).first()
    ).toBeVisible();
  });

  test("inbox renders notification list from seed", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Inbox" }).first()
    ).toBeVisible();

    // At least one notification text should be visible (read or unread)
    await expect(
      page.getByText("Set up staging environment monitoring changed to in progress")
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Console Error Check", () => {
  test("no errors on dashboard load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");
    await waitForApp(page);

    const realErrors = errors.filter(
      (e) =>
        !e.includes("favicon") &&
        !e.includes("HMR") &&
        !e.includes("hydration") &&
        !e.includes("404")
    );

    expect(realErrors).toHaveLength(0);
  });
});

test.describe("Mobile Layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("OIL board renders on mobile viewport", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.getByText("Outstanding items")).toBeVisible();
    await expect(page.getByLabel("Quick add issue")).toBeVisible();
  });

  test("series detail header is readable on mobile", async ({ page }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);
    await expect(
      page.getByRole("button", { name: "Start" })
    ).toBeVisible();
    await expect(page.getByText("Timeline")).toBeVisible();
  });

  test("issue detail renders on mobile", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();
    await expect(page.getByText("Add update").first()).toBeVisible();
  });

  test("inbox renders on mobile", async ({ page }) => {
    await page.goto("/inbox");
    await waitForApp(page);
    await expect(
      page.getByRole("heading", { name: "Inbox" }).first()
    ).toBeVisible();
  });

  test("my actions renders on mobile", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);
    await expect(
      page.getByRole("heading", { name: "My Actions" }).first()
    ).toBeVisible();
  });

  test("settings renders on mobile", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);
    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: "Profile" })
    ).toBeVisible();
  });
});
