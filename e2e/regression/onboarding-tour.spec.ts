import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

async function clearTourState(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("minutia:first-run-tour:")) {
        localStorage.removeItem(key);
      }
    }
  });
}

test.describe("First-run tour", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await clearTourState(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByRole("button", { name: "Add widget" })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("recommends starting the tour from the dashboard", async ({ page }) => {
    await expect(
      page.getByText("We recommend you start the tour first.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Start tour" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip tour" })).toBeVisible();
  });

  test("starts a guided tour with concrete product steps", async ({ page }) => {
    await page.getByRole("button", { name: "Start tour" }).click();

    await expect(page.getByText("Tour 1 of")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your OIL Board" })).toBeVisible();

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add widgets" })).toBeVisible();
    await expect(
      page.getByText("Customize the dashboard with meeting, health, and workload panels.")
    ).toBeVisible();
  });

  test("skip tour persists across reloads", async ({ page }) => {
    await page.getByRole("button", { name: "Skip tour" }).click();
    await expect(
      page.getByText("We recommend you start the tour first.")
    ).not.toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(
      page.getByText("We recommend you start the tour first.")
    ).not.toBeVisible();
  });

  test("add widget exposes an accessible hover and focus tooltip", async ({ page }) => {
    const addWidget = page.getByRole("button", { name: "Add widget" });
    const visibleTooltip = page.locator("[data-slot='tooltip-content']");

    await addWidget.hover();
    await expect(visibleTooltip).toBeVisible();
    await expect(visibleTooltip).toContainText("Add widgets to customize your dashboard.");

    await page.mouse.move(0, 0);
    await addWidget.focus();
    await expect(visibleTooltip).toBeVisible();
    await expect(visibleTooltip).toContainText("Add widgets to customize your dashboard.");
  });

  test("targets the visible mobile search control", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByRole("button", { name: "Add widget" })).toBeVisible();

    await page.getByRole("button", { name: "Start tour" }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Search and shortcuts" })).toBeVisible();
    const spotlight = page.getByTestId("tour-spotlight");
    await expect(spotlight).toBeVisible();
    const box = await spotlight.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(20);
    expect(box?.height ?? 0).toBeGreaterThan(20);
    expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(80);
  });
});
