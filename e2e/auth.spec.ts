import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login page renders correctly", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "minutia" })).toBeVisible();
    await expect(
      page.getByText("The open-source meeting memory system."),
    ).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send magic link" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Google" })).toBeVisible();
  });

  test("magic link form validates email", async ({ page }) => {
    await page.goto("/login");

    const emailInput = page.getByLabel("Email address");
    const submitButton = page.getByRole("button", { name: "Send magic link" });

    await expect(submitButton).toBeDisabled();

    await emailInput.fill("invalid-email");
    await expect(submitButton).toBeEnabled();

    await emailInput.fill("test@example.com");
    await expect(submitButton).toBeEnabled();
  });

  test("unauthenticated user is redirected from app pages", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");
  });
});
