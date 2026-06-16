/**
 * retro-create.spec.ts
 *
 * Assumption: `retro_enabled = 'true'` in instance_config for all tests here.
 * If the migration seeds it as "false" (default for self-host), tests are skipped
 * unless SERVICE_KEY is available to toggle the flag.
 *
 * Tests cover: landing page copy, template picker, board creation, redirect to
 * /retro/<token>, board header with name and phase bar.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function serviceHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

async function setRetroEnabled(
  request: APIRequestContext,
  value: "true" | "false"
) {
  const res = await request.patch(
    `${SUPABASE_URL}/rest/v1/instance_config?key=eq.retro_enabled`,
    { headers: serviceHeaders(), data: { value } }
  );
  // If no row exists, insert it.
  if (!res.ok()) {
    await request.post(`${SUPABASE_URL}/rest/v1/instance_config`, {
      headers: {
        ...serviceHeaders(),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      data: { key: "retro_enabled", value },
    });
  }
}

async function withRetroEnabled(
  request: APIRequestContext,
  fn: () => Promise<void>
) {
  test.skip(!SERVICE_KEY, "Requires SUPABASE_SERVICE_ROLE_KEY to enable retro_enabled");
  await setRetroEnabled(request, "true");
  try {
    await fn();
  } finally {
    // Restore to default-off for self-host safety.
    await setRetroEnabled(request, "false");
  }
}

// Anonymous: no auth required to create a retro board.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Retro create page", () => {
  test("landing page shows hero copy and Start a retro button", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await page.goto("/retro");
      await page.waitForLoadState("domcontentloaded");

      // Hero headline from CreateClient.tsx.
      await expect(
        page.getByRole("heading", {
          name: /The retro where the action items don't die/i,
        })
      ).toBeVisible();

      // The create CTA.
      await expect(
        page.getByRole("button", { name: "Start a retro" })
      ).toBeVisible();

      // Tagline.
      await expect(
        page.getByText(/Free, instant, multiplayer/i).first()
      ).toBeVisible();
    });
  });

  test("clicking Start a retro opens the create form", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await page.goto("/retro");
      await page.waitForLoadState("domcontentloaded");

      await page.getByRole("button", { name: "Start a retro" }).click();

      // CreateRetro header from CreateRetro.tsx.
      await expect(
        page.getByRole("heading", { name: "Start a retro", exact: true })
      ).toBeVisible();

      // Template section.
      await expect(page.getByText("Template")).toBeVisible();

      // The primary CTA inside the form.
      await expect(
        page.getByRole("button", { name: /Create & get link/i })
      ).toBeVisible();
    });
  });

  test("the create form shows available templates", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await page.goto("/retro");
      await page.waitForLoadState("domcontentloaded");

      await page.getByRole("button", { name: "Start a retro" }).click();

      // At least the SSC template is always present.
      await expect(
        page.getByText("Start · Stop · Continue").first()
      ).toBeVisible();
    });
  });

  test("creating a board redirects to /retro/<token> and shows the board name", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await page.goto("/retro");
      await page.waitForLoadState("domcontentloaded");

      await page.getByRole("button", { name: "Start a retro" }).click();

      // Wait for form to appear.
      await expect(
        page.getByRole("heading", { name: "Start a retro", exact: true })
      ).toBeVisible();

      // Type a board name in the name input (placeholder from CreateRetro.tsx).
      const nameInput = page.getByPlaceholder(/Sprint/i).first();
      await nameInput.fill("Q3 Retro E2E Test");

      // Submit.
      await page.getByRole("button", { name: /Create & get link/i }).click();

      // Should navigate to /retro/<token>, wait for URL change.
      await page.waitForURL(/\/retro\/[a-f0-9]{36,}/i, { timeout: 20_000 });

      // Board header in RetroClient.tsx shows the board name.
      await expect(page.getByText("Q3 Retro E2E Test").first()).toBeVisible();
    });
  });

  test("the board page shows the phase bar with Lobby as the initial phase", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await page.goto("/retro");
      await page.waitForLoadState("domcontentloaded");

      await page.getByRole("button", { name: "Start a retro" }).click();
      await expect(
        page.getByRole("heading", { name: "Start a retro", exact: true })
      ).toBeVisible();

      await page.getByRole("button", { name: /Create & get link/i }).click();
      await page.waitForURL(/\/retro\/[a-f0-9]{36,}/i, { timeout: 20_000 });

      // PhaseBar renders the current phase name and all phase labels.
      // "Lobby" is index 0 (current = phaseIdx which starts at 0 for "lobby").
      // The phase labels from PhaseBar: Lobby Reflect Reveal Theme Vote Discuss Commit.
      await expect(page.getByText("Lobby").first()).toBeVisible();
      await expect(page.getByText("Reflect").first()).toBeVisible();
    });
  });

  test("cancelling the create form returns to the landing", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await page.goto("/retro");
      await page.waitForLoadState("domcontentloaded");

      await page.getByRole("button", { name: "Start a retro" }).click();
      await expect(
        page.getByRole("heading", { name: "Start a retro", exact: true })
      ).toBeVisible();

      await page.getByRole("button", { name: "Cancel" }).click();

      // Form closes; landing CTA is back.
      await expect(
        page.getByRole("button", { name: "Start a retro" })
      ).toBeVisible();
    });
  });
});
