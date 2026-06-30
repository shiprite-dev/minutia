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

    await expect(page.getByTestId("login-footer")).toContainText(
      /Own your meeting memory|Control every note|Keep meeting history|Inspect the source|Build on open source|Host the workflow|durable context|decisions and follow-ups|meeting memory layer|useful trail|transcript to action|meeting brain/
    );
    await expect(page.getByTestId("login-footer")).not.toContainText(/free/i);
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

// Public sign-up is gated by NEXT_PUBLIC_ENABLE_PUBLIC_SIGNUP (managed cloud
// only). When off (self-host default, and CI), the dedicated /signup screen is
// unreachable and the login page exposes no sign-up entry point.
const PUBLIC_SIGNUP_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_PUBLIC_SIGNUP === "true";

test.describe("Sign Up", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("self-host: /signup is unreachable and login shows no sign-up entry", async ({
    page,
  }) => {
    test.skip(PUBLIC_SIGNUP_ENABLED, "Public sign-up is enabled in this env");

    await page.goto("/signup");
    await page.waitForURL(/\/login/, { timeout: 10000 });

    await expect(
      page.getByRole("link", { name: /create an account/i })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create account" })
    ).toHaveCount(0);
  });

  test("managed cloud: prominent sign-up link opens a dedicated screen", async ({
    page,
  }) => {
    test.skip(!PUBLIC_SIGNUP_ENABLED, "Public sign-up is disabled in this env");

    await page.goto("/login");
    const signUpLink = page.getByRole("link", { name: /create an account/i });
    await expect(signUpLink).toBeVisible();
    await signUpLink.click();

    await page.waitForURL(/\/signup/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "minutia" })).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account" })
    ).toBeVisible();

    // Back link returns to login.
    await page.getByRole("link", { name: /sign in/i }).click();
    await page.waitForURL(/\/login/, { timeout: 10000 });
  });

  test("managed cloud: create account requires a valid email + 8-char password", async ({
    page,
  }) => {
    test.skip(!PUBLIC_SIGNUP_ENABLED, "Public sign-up is disabled in this env");

    await page.goto("/signup");
    const createButton = page.getByRole("button", { name: "Create account" });
    await expect(createButton).toBeDisabled();

    await page.getByLabel("Email address").fill("new-user@example.com");
    await expect(createButton).toBeDisabled();

    await page.getByLabel("Password").fill("short");
    await expect(createButton).toBeDisabled();

    await page.getByLabel("Password").fill("password123");
    await expect(createButton).toBeEnabled();
  });

  test("managed cloud: signup reaches Supabase auth without a fetch failure", async ({
    page,
  }) => {
    test.skip(!PUBLIC_SIGNUP_ENABLED, "Public sign-up is disabled in this env");

    const signupFailures: string[] = [];
    page.on("requestfailed", (request) => {
      if (request.url().includes("/auth/v1/signup")) {
        signupFailures.push(request.failure()?.errorText ?? "unknown failure");
      }
    });

    await page.goto("/signup");
    await page.getByLabel("Email address").fill(`signup-${Date.now()}@example.com`);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();

    // Either auto-confirm redirect or the "check your email" beat, but never a
    // browser-level fetch failure.
    await expect(page.getByText("Failed to fetch")).toHaveCount(0);
    expect(signupFailures).toEqual([]);
  });
});

function isPasswordAuthRequest(url: string) {
  return url.includes("/auth/v1/token") && url.includes("grant_type=password");
}
