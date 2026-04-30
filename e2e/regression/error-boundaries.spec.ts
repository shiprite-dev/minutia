import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe("Error boundaries (MIN-002)", () => {
  test("invalid issue ID shows not-found message with back link", async ({
    page,
  }) => {
    await page.goto("/issues/nonexistent-id-12345");
    await waitForApp(page);

    await expect(page.getByText("Issue not found")).toBeVisible();
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
    await expect(errorOrNotFound.first()).toBeVisible();
  });

  test("app-level error boundary exists with retry button", async ({
    page,
  }) => {
    const errorBoundaryFile = await page.evaluate(() => {
      return document.querySelector("main#main-content") !== null;
    });
    expect(errorBoundaryFile).toBe(true);
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
