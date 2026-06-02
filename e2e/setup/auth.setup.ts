import { test as setup, expect } from "@playwright/test";

setup.setTimeout(process.env.CI ? 90_000 : 30_000);

setup("authenticate", async ({ browser, request, baseURL }) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const appOrigin = new URL(baseURL ?? "http://localhost:3000").origin;

  if (!supabaseUrl || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required for E2E auth setup.");
  }

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
  });

  if (!authResponse.ok()) {
    throw new Error(`E2E auth setup failed: ${authResponse.status()} ${await authResponse.text()}`);
  }

  const session = await authResponse.json();
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
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/dashboard");

  await page.context().storageState({ path: "e2e/.auth/user.json" });
  await context.close();
});

function getSupabaseAuthCookieName(supabaseUrl: string) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}
