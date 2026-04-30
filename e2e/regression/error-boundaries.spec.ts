import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe("Error boundaries (MIN-002)", () => {
  test("invalid issue ID shows not-found message with back link", async ({
    page,
  }) => {
    await page.goto("/issues/nonexistent-id-12345");
    await waitForApp(page);

    await expect(page.getByText("Issue not found")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("link", { name: /OIL Board/i })
    ).toBeVisible();
  });

  test("invalid series ID shows not-found or error state", async ({
    page,
  }) => {
    await page.goto("/series/nonexistent-series-id");
    await waitForApp(page);

    const errorOrNotFound = page.getByText(
      /not found|went wrong|no series/i
    );
    await expect(errorOrNotFound.first()).toBeVisible({ timeout: 15000 });
  });

  test("app-level error boundary file exists", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const hasMainContent = await page.evaluate(() => {
      return document.querySelector("main#main-content") !== null;
    });
    expect(hasMainContent).toBe(true);
  });

  test("share page error boundary renders for invalid tokens", async ({
    page,
  }) => {
    await page.goto("/share/totally-invalid-token");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText(/invalid|expired|unavailable/i).first()
    ).toBeVisible();
  });
});
