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
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Email magic link" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Google" })).toBeVisible();
  });

  test("password form validates credentials", async ({ page }) => {
    await page.goto("/login");

    const emailInput = page.getByLabel("Email address");
    const passwordInput = page.getByLabel("Password");
    const signInButton = page.getByRole("button", { name: "Sign in", exact: true });
    const createAccountButton = page.getByRole("button", { name: "Create account" });
    const magicLinkButton = page.getByRole("button", { name: "Email magic link" });

    await expect(signInButton).toBeDisabled();
    await expect(createAccountButton).toBeDisabled();
    await expect(magicLinkButton).toBeDisabled();

    await emailInput.fill("test@example.com");
    await expect(magicLinkButton).toBeEnabled();
    await expect(signInButton).toBeDisabled();

    await passwordInput.fill("short");
    await expect(signInButton).toBeEnabled();
    await expect(createAccountButton).toBeDisabled();

    await passwordInput.fill("password123");
    await expect(createAccountButton).toBeEnabled();
  });

  test("unauthenticated user is redirected from app pages", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");
  });
});
