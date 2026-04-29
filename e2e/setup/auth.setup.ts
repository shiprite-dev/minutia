import { test as setup, expect } from "@playwright/test";

setup("authenticate", async ({ page, context, request }) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Sign in via Supabase Auth API directly
  const response = await request.post(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      headers: {
        apikey: supabaseKey,
        "Content-Type": "application/json",
      },
      data: {
        email: "test@example.com",
        password: "password123",
      },
    },
  );

  if (!response.ok()) {
    throw new Error(`Auth setup failed: ${await response.text()}`);
  }

  const data = await response.json();

  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
    token_type: data.token_type,
    user: data.user,
  };

  // Compute the cookie name Supabase SSR expects
  const hostname = new URL(supabaseUrl).hostname;
  const storageKey = `sb-${hostname.split(".")[0]}-auth-token`;

  // Set the auth cookie so the app recognizes the session
  await context.addCookies([
    {
      name: storageKey,
      value: JSON.stringify(session),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  // Navigate to verify the session works
  await page.goto("/");
  await expect(page).toHaveURL("/");

  // Save storage state for reuse across test files
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
