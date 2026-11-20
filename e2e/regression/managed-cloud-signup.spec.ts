import { test, expect } from "@playwright/test";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const serviceHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

test.describe("Managed cloud sign-up", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("aSignedOutVisitorOpeningTheAppAddress_landsOnSignIn_notTheSelfHostPage", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Create an account", exact: true }).click();
    await page.waitForURL(/\/signup$/);
    await expect(page.getByText("Create your account to get started.", { exact: true })).toBeVisible();
  });

  test("login leads with Google and links to a dedicated sign-up screen", async ({
    page,
  }) => {
    await page.goto("/login");
    const google = page.getByRole("button", { name: "Continue with Google" });
    await expect(google).toBeVisible();
    await expect(page.getByText("Also connects your calendar")).toBeVisible();
    expect((await google.boundingBox())!.y).toBeLessThan(
      (await page.getByLabel("Email address").boundingBox())!.y,
    );

    await page.getByRole("link", { name: /create an account/i }).click();
    await page.waitForURL(/\/signup/);
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();

    await page.getByRole("link", { name: /sign in/i }).click();
    await page.waitForURL(/\/login/);
  });

  test("Continue with Google asks for calendar only and keeps earlier Google grants", async ({ page }) => {
    let authorize: URL | null = null;
    await page.route("**/auth/v1/authorize**", async (route) => {
      authorize = new URL(route.request().url());
      await route.fulfill({ contentType: "text/html", body: "<h1>Google consent</h1>" });
    });

    await page.goto("/signup");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByRole("heading", { name: "Google consent" })).toBeVisible();

    const consent = authorize as URL | null;
    expect(consent?.searchParams.get("provider")).toBe("google");
    const scopes = consent?.searchParams.get("scopes")?.split(" ") ?? [];
    expect(scopes).toContain("https://www.googleapis.com/auth/calendar.readonly");
    expect(scopes.some((scope) => scope.includes("directory"))).toBe(false);
    expect(consent?.searchParams.get("include_granted_scopes")).toBe("true");
  });

  test("Continue with Google sits above the email form and email sign-up reaches the account server", async ({
    page,
    request,
  }) => {
    const email = `google-first-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
      await page.goto("/signup");
      const google = page.getByRole("button", { name: "Continue with Google" });
      await expect(google).toBeVisible();
      await expect(page.getByText("Also connects your calendar")).toBeVisible();
      expect((await google.boundingBox())!.y).toBeLessThan(
        (await page.getByLabel("Email address").boundingBox())!.y,
      );

      const createButton = page.getByRole("button", { name: "Create account" });
      await expect(createButton).toBeDisabled();
      await page.getByLabel("Name").fill("Solo Founder");
      await page.getByLabel("Email address").fill(email);
      await page.getByLabel("Password").fill("short");
      await expect(createButton).toBeDisabled();
      await page.getByLabel("Password").fill("password123");
      const signup = page.waitForResponse((res) => res.url().includes("/auth/v1/signup"));
      await createButton.click();
      const response = await signup;

      if (response.ok()) {
        await expect
          .poll(async () => {
            const res = await request.get(
              `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,name`,
              { headers: serviceHeaders },
            );
            const rows = await res.json();
            userId = rows[0]?.id ?? null;
            return rows[0]?.name ?? null;
          })
          .toBe("Solo Founder");
      } else {
        // The bundled Supabase stack keeps GoTrue sign-ups off (invite-only self-host).
        const body = await response.json();
        await expect(page.getByRole("alert").filter({ hasText: body.msg ?? body.message })).toBeVisible();
      }
      await expect(page.getByText("Failed to fetch")).toHaveCount(0);
    } finally {
      if (userId) {
        await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
          headers: serviceHeaders,
        });
      }
    }
  });
});
