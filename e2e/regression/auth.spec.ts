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
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send magic link" })
    ).toBeVisible();

    await expect(page.getByText("or continue with")).toBeVisible();
    await expect(page.getByRole("button", { name: "Google" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in as Guest" })
    ).toBeVisible();

    await expect(
      page.getByText("Open source. Self-host free forever.")
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /GitHub/i })).toBeVisible();
  });

  test("email validation requires valid email", async ({ page }) => {
    await page.goto("/login");
    const submitBtn = page.getByRole("button", { name: "Send magic link" });
    await expect(submitBtn).toBeDisabled();

    await page.getByPlaceholder("you@company.com").fill("test@example.com");
    await expect(submitBtn).toBeEnabled();
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login/, { timeout: 10000 });
  });
});
