/**
 * retro-disabled.spec.ts
 *
 * Assumption: `retro_enabled` is NOT set to "true" in instance_config for these
 * tests. Two approaches are supported:
 *
 * A) The seed DB ships with `retro_enabled = 'false'` (the migration default).
 *    These tests will pass with no extra setup.
 *
 * B) If the E2E suite seeds `retro_enabled = 'true'` globally (e.g. via a
 *    beforeAll hook elsewhere), each test here must override it and restore.
 *    The helper `withRetroDisabled` handles that case when SERVICE_KEY is set.
 *
 * If `retro_enabled` is seeded ON by the suite and SERVICE_KEY is absent,
 * tests are skipped rather than giving a false pass.
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

async function getRetroEnabled(request: APIRequestContext): Promise<string> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/instance_config?key=eq.retro_enabled&select=value`,
    { headers: serviceHeaders() }
  );
  const rows = await res.json() as Array<{ value: string }>;
  return rows[0]?.value ?? "false";
}

async function setRetroEnabled(
  request: APIRequestContext,
  value: "true" | "false"
) {
  await request.patch(
    `${SUPABASE_URL}/rest/v1/instance_config?key=eq.retro_enabled`,
    { headers: serviceHeaders(), data: { value } }
  );
}

// Runs `fn` with retro_enabled forced to "false", then restores original value.
async function withRetroDisabled(
  request: APIRequestContext,
  fn: () => Promise<void>
) {
  const original = await getRetroEnabled(request);
  await setRetroEnabled(request, "false");
  try {
    await fn();
  } finally {
    await setRetroEnabled(request, original as "true" | "false");
  }
}

// Anonymous, retro pages must be accessible without a session.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Retro disabled page", () => {
  test("visiting /retro shows the disabled view when retro_enabled is off", async ({
    page,
    request,
  }) => {
    test.skip(
      !SERVICE_KEY,
      "Requires SUPABASE_SERVICE_ROLE_KEY to toggle retro_enabled; skipped if flag is already off by default"
    );

    await withRetroDisabled(request, async () => {
      await page.goto("/retro");
      await page.waitForLoadState("domcontentloaded");

      // RetroDisabled renders this h1 verbatim.
      await expect(
        page.getByRole("heading", { name: "Retro boards aren't enabled here" })
      ).toBeVisible();

      // Description copy from RetroDisabled.
      await expect(
        page.getByText("An admin can enable them in workspace settings.")
      ).toBeVisible();

      // Back-link navigates to the main app.
      await expect(
        page.getByRole("link", { name: /Back to Minutia/i })
      ).toBeVisible();

      // The "Start a retro" CTA must NOT appear.
      await expect(page.getByRole("button", { name: "Start a retro" })).not.toBeVisible();
    });
  });

  test("the disabled view does not expose the create form", async ({
    page,
    request,
  }) => {
    test.skip(!SERVICE_KEY, "Requires SUPABASE_SERVICE_ROLE_KEY to toggle retro_enabled");

    await withRetroDisabled(request, async () => {
      await page.goto("/retro");
      await page.waitForLoadState("domcontentloaded");

      // No template picker, no name input, the disabled shell replaces all children.
      await expect(page.getByText("Template")).not.toBeVisible();
      await expect(page.getByPlaceholder(/Sprint/i)).not.toBeVisible();
    });
  });

  test("navigating to a board token while disabled shows the disabled view", async ({
    page,
    request,
  }) => {
    test.skip(!SERVICE_KEY, "Requires SUPABASE_SERVICE_ROLE_KEY to toggle retro_enabled");

    await withRetroDisabled(request, async () => {
      // A plausible but non-existent token; the layout gate fires before snapshot.
      await page.goto("/retro/00000000000000000000000000000000");
      await page.waitForLoadState("domcontentloaded");

      await expect(
        page.getByRole("heading", { name: "Retro boards aren't enabled here" })
      ).toBeVisible();
    });
  });
});
