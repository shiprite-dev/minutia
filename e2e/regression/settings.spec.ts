import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { waitForApp } from "./seed-data";

test.describe("Settings Page", () => {
  test("renders all setting cards", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    // CardTitle renders as a div with data-slot, not a heading role
    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: "Profile" })
    ).toBeVisible();
    await expect(
      page.getByText("Your display name and account details.")
    ).toBeVisible();
    await expect(page.getByLabel("Display name")).toBeVisible();
    await expect(page.getByText("test@example.com").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save" })
    ).toBeVisible();

    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: "Appearance" })
    ).toBeVisible();
    await expect(
      page.getByText("Choose how Minutia looks for you.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Light" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Dark" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "System" })
    ).toBeVisible();

    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: "Export data" })
    ).toBeVisible();
    await expect(
      page.getByText("Download all your issues as CSV or JSON.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export CSV" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export JSON" })
    ).toBeVisible();
  });

  test("display name is pre-filled with user name", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const nameInput = page.getByLabel("Display name");
    await expect(nameInput).toHaveValue("Test User");
  });

  test("save button is disabled when name unchanged", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    await expect(page.getByLabel("Display name")).toHaveValue("Test User");
    await expect(
      page.getByRole("button", { name: "Save" })
    ).toBeDisabled();
  });

  test("save button enables when name is changed", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    await expect(page.getByLabel("Display name")).toHaveValue("Test User");

    await page.getByLabel("Display name").fill("New Name");
    await expect(
      page.getByRole("button", { name: "Save" })
    ).toBeEnabled();
  });

  test("export buttons show issue count", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    await expect(
      page.getByText(/issues available for export/)
    ).toBeVisible();
  });

  test("CSV export includes issue keys", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    const csv = await readFile(path!, "utf8");
    expect(csv).toContain("Issue Key");
    expect(csv).toContain("OIL-1");
  });

  test("JSON export includes issue keys", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    const json = JSON.parse(await readFile(path!, "utf8")) as Array<{
      issue_key?: string;
    }>;
    expect(json.some((issue) => issue.issue_key === "OIL-1")).toBe(true);
  });

  test("theme buttons switch appearance", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    await page.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
