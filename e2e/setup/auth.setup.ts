import { test as setup, expect } from "@playwright/test";

setup.setTimeout(process.env.CI ? 90_000 : 30_000);

const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

setup("authenticate", async ({ browser, request, baseURL }) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const appOrigin = new URL(baseURL ?? APP_URL).origin;

  if (!supabaseUrl || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required for E2E auth setup.");
  }

  const session = await signInSeedUser(request, supabaseUrl, anonKey);
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: getSupabaseAuthCookieName(supabaseUrl),
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`,
      url: appOrigin,
      expires: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();
  await page.goto(`${appOrigin}/dashboard`);
  await expect(page).toHaveURL(`${appOrigin}/dashboard`);
  await page.evaluate((userId) => {
    if (userId) {
      localStorage.setItem(`minutia:first-run-tour:${userId}:v1`, "dismissed");
    }
  }, session.user?.id);

  await page.context().storageState({ path: "e2e/.auth/user.json" });
  await context.close();
});

function getSupabaseAuthCookieName(supabaseUrl: string) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

async function signInSeedUser(
  request: import("@playwright/test").APIRequestContext,
  supabaseUrl: string,
  anonKey: string
) {
  const deadline = Date.now() + (process.env.CI ? 90_000 : 30_000);
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const authResponse = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        data: {
          email: "test@example.com",
          password: "password123",
        },
        timeout: 5_000,
      });

      const body = await authResponse.text();
      if (authResponse.ok()) return JSON.parse(body);

      lastError = `${authResponse.status()} ${body}`;
      if (!isTransientAuthStartupError(lastError)) {
        throw new Error(`E2E auth setup failed: ${lastError}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (!isTransientAuthStartupError(lastError)) {
        throw new Error(`E2E auth setup failed: ${lastError}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`E2E auth setup timed out waiting for local auth: ${lastError}`);
}

function isTransientAuthStartupError(message: string) {
  return (
    message.includes("email_provider_disabled") ||
    message.includes("ECONNREFUSED") ||
    message.includes("Timeout")
  );
}
