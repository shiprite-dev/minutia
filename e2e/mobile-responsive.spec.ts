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
    await expect(page.getByText("Timeline")).toBeVisible();
  });

  test("issue detail renders on mobile", async ({ page }) => {
    await page.goto("/issues/30000000-0000-0000-0000-000000000001");
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();
    await expect(page.getByText("Add update")).toBeVisible();
  });

  test("issue detail chrome stays readable and uses styled date controls", async ({ page }) => {
    await page.goto("/issues/30000000-0000-0000-0000-000000000001");

    const backButton = page.getByRole("button", { name: "Back" });
    const issueKey = page.getByLabel(/Issue key OIL-/);
    await expect(backButton).toBeVisible();
    await expect(issueKey).toBeVisible();
    await expect(issueKey).toHaveText(/^OIL-\d+$/);

    const backBox = await backButton.boundingBox();
    const keyBox = await issueKey.boundingBox();
    expect(backBox).not.toBeNull();
    expect(keyBox).not.toBeNull();

    const overlaps =
      backBox!.x < keyBox!.x + keyBox!.width &&
      backBox!.x + backBox!.width > keyBox!.x &&
      backBox!.y < keyBox!.y + keyBox!.height &&
      backBox!.y + backBox!.height > keyBox!.y;
    const horizontalGap = keyBox!.x - (backBox!.x + backBox!.width);

    expect(overlaps).toBe(false);
    expect(horizontalGap).toBeGreaterThanOrEqual(24);

    const dueDate = page.getByRole("button", { name: "Due date" });
    await expect(dueDate).toBeVisible();
    await expect(dueDate).toBeEnabled();
  });

  test("inbox renders on mobile", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" }).first()).toBeVisible();
  });
});
