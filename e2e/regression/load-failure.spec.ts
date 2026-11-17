import { test, expect, type Page } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe.configure({ timeout: 90_000 });

const RETRY_WINDOW = 25_000;
const REST = ["**/rest/v1/issues*", "**/rest/v1/meeting_series*"];

async function failRequests(page: Page, patterns: string[]) {
  for (const p of patterns) await page.route(p, (route) => route.abort());
}

async function restoreRequests(page: Page, patterns: string[]) {
  for (const p of patterns) await page.unroute(p);
}

test.describe("honest load-failure state", () => {
  test("board shows a retryable error instead of the first-run CTA, and Retry restores rows", async ({
    page,
  }) => {
    await failRequests(page, REST);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible({ timeout: RETRY_WINDOW });
    await expect(page.getByText("Create your first series")).toHaveCount(0);

    await restoreRequests(page, REST);
    await retry.click();

    await expect(page.getByTestId("widget-outstanding-1")).toBeVisible({
      timeout: RETRY_WINDOW,
    });
    await expect(
      page.getByText("Update API rate limiting config").first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });

  test("My Actions never claims nothing is owed when the load failed", async ({
    page,
  }) => {
    await failRequests(page, REST);
    await page.goto("/actions", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible({ timeout: RETRY_WINDOW });
    await expect(page.getByText(/owe nobody anything/i)).toHaveCount(0);

    await restoreRequests(page, REST);
    await retry.click();

    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0, {
      timeout: RETRY_WINDOW,
    });
    await expect(
      page
        .getByText(/owe nobody anything/i)
        .or(page.getByText("Needs attention"))
        .first(),
    ).toBeVisible();
  });

  test("Inbox never says all caught up when the load failed", async ({
    page,
  }) => {
    const pattern = "**/rest/v1/notifications*";
    await failRequests(page, [pattern]);
    await page.goto("/inbox", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible({ timeout: RETRY_WINDOW });
    await expect(page.getByText("All caught up.")).toHaveCount(0);

    await restoreRequests(page, [pattern]);
    await retry.click();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0, {
      timeout: RETRY_WINDOW,
    });
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  });

  test("Series list shows a retryable error, then the series", async ({
    page,
  }) => {
    const pattern = "**/rest/v1/meeting_series*";
    await failRequests(page, [pattern]);
    await page.goto("/series", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible({ timeout: RETRY_WINDOW });

    await restoreRequests(page, [pattern]);
    await retry.click();
    await expect(
      page.getByRole("link", { name: /Platform Standup/ }).first(),
    ).toBeVisible({
      timeout: RETRY_WINDOW,
    });
  });

  test("Issue detail offers Retry instead of 'not found' when the request fails", async ({
    page,
  }) => {
    const pattern = "**/rest/v1/issues*";
    await failRequests(page, [pattern]);
    await page.goto("/issues/30000000-0000-0000-0000-000000000001", {
      waitUntil: "domcontentloaded",
    });
    await waitForApp(page);

    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible({ timeout: RETRY_WINDOW });
    await expect(page.getByText("Issue not found.")).toHaveCount(0);

    await restoreRequests(page, [pattern]);
    await retry.click();
    await expect(page.getByText("Lifecycle timeline")).toBeVisible({
      timeout: RETRY_WINDOW,
    });
  });
});
