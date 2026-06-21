import { test, expect } from "@playwright/test";
import { waitForApp } from "./regression/seed-data";

// The FAB delegates to the global QuickAddDialog. The N shortcut and the
// dialog's submit/validation behavior are covered by quick-add-shortcut.spec.ts;
// this file owns the FAB click path specifically.
test.describe("Quick Add FAB", () => {
  test("FAB is visible on the OIL Board", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await expect(page.getByLabel("Quick add issue")).toBeVisible();
  });

  test("clicking the FAB opens the global quick-add dialog", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.getByLabel("Quick add issue").click();

    await expect(
      page.getByRole("textbox", { name: "Issue title" })
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Series", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add issue", exact: true })
    ).toBeVisible();
  });
});
