import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

// FRICTION-001 slice 1: global "N" quick-add shortcut from any screen.
test.describe("Quick Add shortcut (N)", () => {
  test("N opens the global quick-add dialog from the board", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.keyboard.press("n");

    await expect(page.getByRole("textbox", { name: "Issue title" })).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Series", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add issue", exact: true })
    ).toBeVisible();
  });

  test("N from a non-board screen also opens the dialog", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    await page.keyboard.press("n");

    await expect(page.getByRole("textbox", { name: "Issue title" })).toBeVisible();
  });

  test("filling title, picking a series and submitting creates the issue", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.keyboard.press("n");

    const titleInput = page.getByRole("textbox", { name: "Issue title" });
    await expect(titleInput).toBeVisible();

    const testTitle = `Quick add shortcut ${Date.now()}`;
    await titleInput.fill(testTitle);

    await page.getByRole("combobox", { name: "Series", exact: true }).click();
    await page.getByRole("option", { name: "Platform Team Standup" }).click();

    const addButton = page.getByRole("button", { name: "Add issue", exact: true });
    await expect(addButton).toBeEnabled();
    await addButton.click();

    // Dialog closes after a successful submit.
    await expect(titleInput).not.toBeVisible({ timeout: 5000 });

    // The new issue may sit behind "+N more" on the board, so verify on the series page.
    await page
      .getByRole("link", { name: /Platform Team Standup/ })
      .first()
      .click();
    await expect(page.getByText(testTitle).first()).toBeVisible({ timeout: 10000 });
  });

  test("submitting an empty title shows an inline error and keeps the dialog open", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.keyboard.press("n");

    const titleInput = page.getByRole("textbox", { name: "Issue title" });
    await expect(titleInput).toBeVisible();

    await page.getByRole("button", { name: "Add issue", exact: true }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(titleInput).toBeVisible();
  });

  test("N does NOT open the dialog while focused in an input", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    // The command palette input is a reliable, always-available text field.
    await page.keyboard.press("Meta+k");
    const search = page.getByPlaceholder(/Search pages, series, issues/);
    await expect(search).toBeVisible();
    await search.click();

    await page.keyboard.press("n");

    await expect(
      page.getByRole("combobox", { name: "Series", exact: true })
    ).toHaveCount(0);
    await expect(search).toHaveValue("n");
  });
});
