import { test, expect } from "@playwright/test";

test.describe("Login Page", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("renders all login elements", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "minutia" })).toBeVisible();
    await expect(
      page.getByText("The open-source meeting memory system.")
    ).toBeVisible();

    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Email magic link" })
    ).toHaveCount(0);

    await expect(page.getByText("or continue with")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Google" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Sign in as Guest" })
    ).toHaveCount(0);

    await expect(
      page.getByText("Open source. Self-host free forever.")
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /GitHub/i })).toBeVisible();
  });

  test("password auth controls require credentials", async ({ page }) => {
    await page.goto("/login");
    const signInButton = page.getByRole("button", { name: "Sign in", exact: true });

    await expect(signInButton).toBeDisabled();
    await expect(page.getByRole("button", { name: "Email magic link" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Google" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in as Guest" })).toHaveCount(0);

    await page.getByPlaceholder("you@company.com").fill("test@example.com");
    await expect(signInButton).toBeDisabled();

    await page.getByLabel("Password").fill("short");
    await expect(signInButton).toBeEnabled();

    await page.getByLabel("Password").fill("password123");
    await expect(signInButton).toBeEnabled();
  });

  test("forgot password starts the recovery flow", async ({ page }) => {
    await page.route("**/api/password-reset-requests", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    });

    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill("test@example.com");
    await page.getByRole("button", { name: "Forgot password?" }).click();

    await expect(page.getByText("Check your email")).toBeVisible();
    await expect(
      page.getByText("We sent a password reset link to test@example.com")
    ).toBeVisible();
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 10000 });
  });
});
