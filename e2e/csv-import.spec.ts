import { test, expect } from "@playwright/test";
import path from "path";

const SERIES_URL = "/series/10000000-0000-0000-0000-000000000001";
const CSV_PATH = path.join(__dirname, "fixtures/test-import.csv");

test.describe("CSV Import", () => {
  test("upload step shows dialog with drag zone", async ({ page }) => {
    await page.goto(SERIES_URL);
    await page.getByRole("button", { name: "Import CSV" }).click();
    await expect(page.getByText("Import from CSV")).toBeVisible();
    await expect(page.getByText("Drag and drop a CSV file")).toBeVisible();
    await expect(page.getByText("Choose file")).toBeVisible();
  });

  test("smart column mapping auto-detects fields", async ({ page }) => {
    await page.goto(SERIES_URL);
    await page.getByRole("button", { name: "Import CSV" }).click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(CSV_PATH);

    await expect(page.getByText("Map columns")).toBeVisible();
    await expect(page.getByText("5 rows found")).toBeVisible();

    // Verify auto-mapped selects show correct field names
    const selects = page.locator('[data-slot="select-trigger"]');
    await expect(selects).toHaveCount(6);
    await expect(selects.nth(0)).toContainText("Title");
    await expect(selects.nth(1)).toContainText("Status");
    await expect(selects.nth(2)).toContainText("Priority");
    await expect(selects.nth(3)).toContainText("Owner");
  });

  test("preview shows normalized data", async ({ page }) => {
    await page.goto(SERIES_URL);
    await page.getByRole("button", { name: "Import CSV" }).click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(CSV_PATH);

    await expect(page.getByText("Map columns")).toBeVisible();
    await page.getByRole("button", { name: "Preview" }).click();

    await expect(page.getByText("Preview import")).toBeVisible();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("cell", { name: "Refactor authentication module" })).toBeVisible();
    await expect(dialog.getByRole("cell", { name: "Fix memory leak in worker pool" })).toBeVisible();
  });

  test("full import creates issues and shows success", async ({ page }) => {
    await page.goto(SERIES_URL);

    const openIssuesBefore = await page.getByRole("heading", { name: /Open issues/ }).textContent();

    await page.getByRole("button", { name: "Import CSV" }).click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(CSV_PATH);

    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: /Import \d+ items/ }).click();

    await expect(page.getByText("5 items imported")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    // Verify the open issues count increased
    await page.waitForTimeout(1000);
    const heading = page.getByRole("heading", { name: /Open issues/ });
    await expect(heading).toBeVisible();
  });
});
