import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("Mobile Responsive", () => {
  test("OIL board renders on mobile viewport", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();
    await expect(page.getByLabel("Quick add issue")).toBeVisible();
  });

  test("series detail header is readable on mobile", async ({ page }) => {
    await page.goto("/series/10000000-0000-0000-0000-000000000001");
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(page.getByText("Meeting history")).toBeVisible();
  });

  test("issue detail renders on mobile", async ({ page }) => {
    await page.goto("/issues/30000000-0000-0000-0000-000000000001");
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();
    await expect(page.getByText("Add update")).toBeVisible();
  });

  test("inbox renders on mobile", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" }).first()).toBeVisible();
  });
});
