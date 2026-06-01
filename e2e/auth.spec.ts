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
    await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Email magic link" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Google" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in as Guest" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Forgot password?" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Request invite" })).toHaveCount(0);
  });

  test("password form validates credentials", async ({ page }) => {
    await page.goto("/login");

    const emailInput = page.getByLabel("Email address");
    const passwordInput = page.getByLabel("Password");
    const signInButton = page.getByRole("button", { name: "Sign in", exact: true });

    await expect(signInButton).toBeDisabled();
    await expect(page.getByRole("button", { name: "Email magic link" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Google" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in as Guest" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Forgot password?" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Request invite" })).toHaveCount(0);

    await emailInput.fill("test@example.com");
    await expect(signInButton).toBeDisabled();

    await passwordInput.fill("short");
    await expect(signInButton).toBeEnabled();

    await passwordInput.fill("password123");
    await expect(signInButton).toBeEnabled();
  });

  test("password reset request is handled by the backend email path", async ({ request }) => {
    const res = await request.post("/api/password-reset-requests", {
      data: { email: "test@example.com" },
    });

    await expect(res).toBeOK();
  });

  test("unauthenticated user is redirected from app pages", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 10000 });
    expect(page.url()).toContain("/login");
  });
});
