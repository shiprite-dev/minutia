import { test, expect } from "@playwright/test";

test.describe("Export", () => {
  test("settings page shows export card with issue count", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Export data")).toBeVisible();
    await expect(page.getByText(/\d+ issues available for export/)).toBeVisible();
  });

  test("CSV export triggers download", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText(/\d+ issues available/)).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/minutia-issues-.*\.csv/);
  });

  test("JSON export triggers download", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText(/\d+ issues available/)).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/minutia-issues-.*\.json/);
  });
});
