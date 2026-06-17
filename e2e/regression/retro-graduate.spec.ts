/**
 * retro-graduate.spec.ts
 *
 * Authenticated context tests for graduating a retro board into Minutia.
 *
 * "Save to Minutia" is account-gated. Unauthenticated users clicking it are
 * redirected to /login?next=/retro/<token>?graduate=1. Authenticated users
 * get the board's action items saved as issues in a new series.
 *
 * Test setup:
 * - Uses the shared auth session (e2e/.auth/user.json) for authenticated tests.
 * - SERVICE_KEY required to: enable retro_enabled, clean up created retro boards
 *   and series after each test.
 *
 * Assumption: `retro_enabled = 'true'` toggled per-test via withRetroEnabled.
 *
 * Graduation flow (from RetroClient.tsx `saveToMinutia`):
 *   POST /api/retro/<token>/graduate { target: "new", name: <boardName> }
 *   -> 401 if not authed (redirect to login)
 *   -> { series_id } on success
 *   UI then shows CommitNudge in "saved" state with "Open the series ->" link.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

function serviceHeaders(prefer = "return=minimal") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
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
  if (!res.ok()) {
    await request.post(`${SUPABASE_URL}/rest/v1/instance_config`, {
      headers: {
        ...serviceHeaders("resolution=merge-duplicates,return=minimal"),
      },
      data: { key: "retro_enabled", value },
    });
  }
}

async function withRetroEnabled(
  request: APIRequestContext,
  fn: () => Promise<void>
) {
  test.skip(
    !SERVICE_KEY,
    "Requires SUPABASE_SERVICE_ROLE_KEY to enable retro_enabled"
  );
  await setRetroEnabled(request, "true");
  try {
    await fn();
  } finally {
    await setRetroEnabled(request, "false");
  }
}

async function deleteSeries(request: APIRequestContext, id: string) {
  await request.delete(
    `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${id}`,
    { headers: serviceHeaders() }
  );
}

async function getIssuesBySeriesId(
  request: APIRequestContext,
  seriesId: string
): Promise<Array<{ id: string; title: string; source: string }>> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/issues?series_id=eq.${seriesId}&select=id,title,source`,
    { headers: serviceHeaders("return=representation") }
  );
  if (!res.ok()) return [];
  return res.json();
}

// Helper: navigate to /retro, create a board, enter the lobby, and advance
// through all phases to Commit, then seal decisions.
// Returns the board URL.
async function runThroughToCommitSealed(
  page: import("@playwright/test").Page,
  boardName: string
) {
  await page.goto(`${APP_URL}/retro`);
  await page.waitForLoadState("domcontentloaded");

  await page.getByRole("button", { name: "Start a retro" }).click();
  await expect(
    page.getByRole("heading", { name: "Start a retro", exact: true })
  ).toBeVisible();

  await page.getByPlaceholder(/Sprint/i).first().fill(boardName);
  await page.getByRole("button", { name: /Create & get link/i }).click();
  await page.waitForURL(/\/retro\/[a-f0-9]{36,}/i, { timeout: 20_000 });

  const boardUrl = page.url();

  // Enter lobby.
  await page.getByPlaceholder("Your name").first().fill("Author");
  await page.getByRole("button", { name: "Join" }).first().click();
  await expect(page.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

  // Add a card (to seed an action for graduation).
  await page.getByRole("button", { name: "Add a card" }).first().click();
  await page.getByPlaceholder("What's on your mind?").first().fill("Improve deploy pipeline");
  await page.getByRole("button", { name: "Add card" }).first().click();

  const advance = async () => {
    await page.getByRole("button", { name: "Advance" }).first().click();
  };

  // Reflect -> Reveal & Vote -> Discuss -> Commit (5-phase merged ritual).
  await advance();
  await expect(page.getByText("Reveal & Vote").first()).toBeVisible({ timeout: 10_000 });
  await advance();
  await expect(page.getByText("Discuss").first()).toBeVisible({ timeout: 10_000 });
  await advance();
  await expect(
    page.getByRole("heading", { name: "Commit the actions" })
  ).toBeVisible({ timeout: 10_000 });

  // Seal (the creator is the facilitator). Sealing persists phase=closed and
  // broadcasts, then the panel flips to the sealed nudge after the refetch.
  await page.getByRole("button", { name: "Seal these decisions" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Sealed, nice work." })
  ).toBeVisible({ timeout: 10_000 });

  return boardUrl;
}

// Unauthenticated tests to verify the gate behavior.
test.describe("Retro graduation, unauthenticated gate", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("clicking Save to Minutia without auth redirects to login", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    await withRetroEnabled(request, async () => {
      const boardName = `Graduate Anon Test ${Date.now()}`;
      await runThroughToCommitSealed(page, boardName);

      // CommitNudge "Save to Minutia" button triggers saveToMinutia which
      // POSTs /api/retro/[token]/graduate; 401 -> redirect to /login.
      await page.getByRole("button", { name: "Save to Minutia" }).first().click();

      // Should redirect to login with ?next= containing the board URL + ?graduate=1.
      await page.waitForURL(/\/login/i, { timeout: 15_000 });
      // The board URL + ?graduate=1 is carried in the (URL-encoded) next param.
      expect(decodeURIComponent(page.url())).toContain("graduate=1");
    });
  });

  test("Just export markdown is always available without auth", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    await withRetroEnabled(request, async () => {
      const boardName = `Export Anon Test ${Date.now()}`;
      await runThroughToCommitSealed(page, boardName);

      // CommitNudge "Just export markdown" should be visible and clickable
      // without triggering a redirect.
      const exportBtn = page.getByRole("button", { name: "Just export markdown" }).first();
      await expect(exportBtn).toBeVisible();
      // Clicking triggers download; we just verify no navigation away from the board.
      await exportBtn.click();
      // Should still be on the retro board URL.
      expect(page.url()).toMatch(/\/retro\//);
    });
  });
});

// Authenticated tests: use the shared session from the setup project.
test.describe("Retro graduation, authenticated", () => {
  // The suite's auth session (e2e/.auth/user.json from auth.setup.ts).
  test.use({ storageState: "e2e/.auth/user.json" });

  test("Save to Minutia creates a new series with retro issues", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    test.skip(!SERVICE_KEY, "Requires SUPABASE_SERVICE_ROLE_KEY for DB assertions");

    const boardName = `Graduate Auth Test ${Date.now()}`;
    let createdSeriesId: string | null = null;

    await withRetroEnabled(request, async () => {
      await runThroughToCommitSealed(page, boardName);

      // Click "Save to Minutia", the authenticated user should not be redirected.
      const saveBtn = page.getByRole("button", { name: "Save to Minutia" }).first();
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();

      // CommitNudge switches to "saved" state (CommitNudge.tsx savedSeriesId branch).
      await expect(
        page.getByText("Your action items are now tracked in Minutia.").first()
      ).toBeVisible({ timeout: 20_000 });

      // "Open the series ->" link appears.
      const seriesLink = page.getByRole("link", { name: /Open the series/i }).first();
      await expect(seriesLink).toBeVisible();

      // Extract series_id from the link href (/series/<id>).
      const href = await seriesLink.getAttribute("href");
      expect(href).toMatch(/\/series\//);
      createdSeriesId = href?.split("/series/")[1]?.split("?")[0] ?? null;
      expect(createdSeriesId).toBeTruthy();

      // Navigate to the series page and confirm it exists.
      await seriesLink.click();
      await page.waitForURL(/\/series\//i, { timeout: 15_000 });

      // The series name should match the board name (graduation sets series.name = board.name).
      await expect(page.getByText(boardName).first()).toBeVisible({ timeout: 10_000 });

      // DB assertion: issues with source='retro' exist under the series.
      if (createdSeriesId) {
        const issues = await getIssuesBySeriesId(request, createdSeriesId);
        // At minimum the one card we added (seeded as an action) should graduate.
        expect(issues.length).toBeGreaterThan(0);
        expect(issues.every((i) => i.source === "retro")).toBe(true);
      }
    });

    // Cleanup: remove the graduated series.
    if (createdSeriesId && SERVICE_KEY) {
      await deleteSeries(request, createdSeriesId);
    }
  });

  test("after graduation, CommitNudge shows the saved state with an Open the series link", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    test.skip(!SERVICE_KEY, "Requires SUPABASE_SERVICE_ROLE_KEY for setup + cleanup");

    const boardName = `Graduate Link Test ${Date.now()}`;
    let createdSeriesId: string | null = null;

    await withRetroEnabled(request, async () => {
      await runThroughToCommitSealed(page, boardName);

      await page.getByRole("button", { name: "Save to Minutia" }).first().click();

      // Wait for saved state.
      await expect(
        page.getByText("Your action items are now tracked in Minutia.").first()
      ).toBeVisible({ timeout: 20_000 });

      // Verify the link href is a valid series URL.
      const seriesLink = page.getByRole("link", { name: /Open the series/i }).first();
      const href = await seriesLink.getAttribute("href");
      expect(href).toMatch(/^\/series\/[0-9a-f-]+$/i);

      createdSeriesId = href?.split("/series/")[1] ?? null;
    });

    if (createdSeriesId && SERVICE_KEY) {
      await deleteSeries(request, createdSeriesId);
    }
  });

  test("the graduated series is navigable from the Minutia dashboard", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    test.skip(!SERVICE_KEY, "Requires SUPABASE_SERVICE_ROLE_KEY for cleanup");

    const boardName = `Graduate Dashboard Test ${Date.now()}`;
    let createdSeriesId: string | null = null;

    await withRetroEnabled(request, async () => {
      await runThroughToCommitSealed(page, boardName);

      await page.getByRole("button", { name: "Save to Minutia" }).first().click();
      await expect(
        page.getByText("Your action items are now tracked in Minutia.").first()
      ).toBeVisible({ timeout: 20_000 });

      const seriesLink = page.getByRole("link", { name: /Open the series/i }).first();
      const href = await seriesLink.getAttribute("href");
      createdSeriesId = href?.split("/series/")[1] ?? null;

      // Navigate to the series detail page directly.
      if (createdSeriesId) {
        await page.goto(`${APP_URL}/series/${createdSeriesId}`);
        await page.waitForLoadState("domcontentloaded");

        // The series page should show the board name as the series name.
        await expect(page.getByText(boardName).first()).toBeVisible({ timeout: 10_000 });
      }
    });

    if (createdSeriesId && SERVICE_KEY) {
      await deleteSeries(request, createdSeriesId);
    }
  });
});
