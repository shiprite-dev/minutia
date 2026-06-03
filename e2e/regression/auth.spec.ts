import { test, expect, type APIRequestContext } from "@playwright/test";
import { readOutbox, withOutbox } from "../helpers/outbox";

const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function serviceHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function createAuthUser(request: APIRequestContext, email: string) {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: serviceHeaders(),
    data: {
      email,
      password: "password123",
      email_confirm: true,
      user_metadata: { name: email.split("@")[0] },
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return (body.id ?? body.user?.id) as string;
}

async function deleteAuthUser(request: APIRequestContext, userId: string | null) {
  if (!userId) return;
  await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: serviceHeaders(),
  });
}

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
      page.getByRole("button", { name: "Forgot password?" })
    ).toBeVisible();
    await expect(page.getByText("Need access to this Minutia workspace?")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Request invite" })
    ).toBeVisible();

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
    const forgotPasswordButton = page.getByRole("button", { name: "Forgot password?" });
    const requestInviteButton = page.getByRole("button", { name: "Request invite" });
    await expect(forgotPasswordButton).toBeDisabled();
    await expect(requestInviteButton).toBeDisabled();

    await page.getByPlaceholder("you@company.com").fill("test@example.com");
    await expect(forgotPasswordButton).toBeEnabled();
    await expect(requestInviteButton).toBeEnabled();
    await expect(signInButton).toBeDisabled();

    await page.getByLabel("Password").fill("short");
    await expect(signInButton).toBeEnabled();

    await page.getByLabel("Password").fill("password123");
    await expect(signInButton).toBeEnabled();
  });

  test("password login reaches Supabase auth without a browser fetch failure", async ({ page }) => {
    const authRequests: string[] = [];
    const authFailures: string[] = [];

    page.on("request", (request) => {
      if (isPasswordAuthRequest(request.url())) authRequests.push(request.url());
    });
    page.on("requestfailed", (request) => {
      if (isPasswordAuthRequest(request.url())) {
        authFailures.push(request.failure()?.errorText ?? "unknown request failure");
      }
    });

    await page.goto("/login");
    await page.getByLabel("Email address").fill(`missing-${Date.now()}@example.com`);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByText("Invalid login credentials")).toBeVisible();
    expect(authRequests.length).toBeGreaterThan(0);
    expect(authFailures).toEqual([]);
    await expect(page.getByText("Failed to fetch")).toHaveCount(0);
  });

  test("password reset email opens the reset password page", async ({
    browser,
    request,
  }) => {
    test.skip(!SERVICE_KEY, "Requires service role for password reset setup");

    const email = `reset-${Date.now()}@example.com`;
    let userId: string | null = null;
    const resetContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });

    try {
      userId = await createAuthUser(request, email);

      await withOutbox(async () => {
        const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
          data: { email },
        });
        expect(res.ok()).toBeTruthy();

        const [message] = await readOutbox();
        expect(message.to).toBe(email);
        const resetUrl = message.text.match(/https?:\/\/\S+/)?.[0];
        expect(resetUrl).toBeTruthy();
        expect(new URL(resetUrl!).searchParams.get("redirect_to")).toBe(
          `${APP_URL}/reset-password`
        );

        const resetPage = await resetContext.newPage();
        await resetPage.goto(resetUrl!);
        await expect(resetPage).toHaveURL(`${APP_URL}/reset-password`);
        await expect(
          resetPage.getByRole("heading", { name: "minutia" })
        ).toBeVisible();
        await expect(resetPage.getByLabel("New password")).toBeVisible();
        await resetPage.getByLabel("New password").fill("new-password123");
        await resetPage.getByLabel("Confirm password").fill("new-password123");
        await resetPage.getByRole("button", { name: "Update password" }).click();
        await expect(
          resetPage.getByText("Password updated. Sign in with your new password.")
        ).toBeVisible();
      });
    } finally {
      await resetContext.close();
      await deleteAuthUser(request, userId);
    }
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 10000 });
  });
});

function isPasswordAuthRequest(url: string) {
  return url.includes("/auth/v1/token") && url.includes("grant_type=password");
}
