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

  test("save button re-enables after value change", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const nameInput = page.getByLabel("Display name");
    await nameInput.fill("Test User");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    await nameInput.fill("Modified Name");
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
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

  test("CSV export has correct headers", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    const csv = await readFile(path!, "utf8");
    const headers = csv.split("\n")[0];
    expect(headers).toContain("Issue Key");
    expect(headers).toContain("Title");
    expect(headers).toContain("Status");
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

  test("JSON export is valid JSON array", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    const content = await readFile(path!, "utf8");
    const json = JSON.parse(content);
    expect(Array.isArray(json)).toBe(true);
  });

  test("theme buttons switch appearance", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    await page.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("theme persists after page reload", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    await page.getByRole("button", { name: "Dark" }).click();
    await page.reload();
    await waitForApp(page);
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.getByRole("button", { name: "Light" }).click();
    await page.reload();
    await waitForApp(page);
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("name validation prevents empty names", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const nameInput = page.getByLabel("Display name");
    await nameInput.fill("");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(
      page.getByText("Name must be between 1 and 100 characters")
    ).toBeVisible();
  });

  test("name validation prevents names longer than 100 characters", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const nameInput = page.getByLabel("Display name");
    await nameInput.fill("a".repeat(101));
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(
      page.getByText("Name must be between 1 and 100 characters")
    ).toBeVisible();
  });

  test("name save shows success message", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const nameInput = page.getByLabel("Display name");
    await nameInput.fill("Updated Name");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Profile updated")).toBeVisible();
    await expect(nameInput).toHaveValue("Updated Name");
  });
});
