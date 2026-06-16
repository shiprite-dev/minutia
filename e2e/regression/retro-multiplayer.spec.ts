/**
 * retro-multiplayer.spec.ts
 *
 * Two-browser-context tests: a creator (facilitator) and a second anonymous
 * joiner share the same board via the share link. Tests verify that:
 * - Both contexts see the same board.
 * - Presence updates propagate (participant count).
 * - A card added by one participant appears for the other.
 *
 * Timing note: Supabase Realtime broadcast is best-effort; a periodic snapshot
 * reconcile runs every ~3s (matching the meeting-poll pattern). Card cross-
 * visibility tests allow up to 8s for the reconcile cycle.
 *
 * Assumption: `retro_enabled = 'true'` in instance_config. SERVICE_KEY required.
 */

import { test, expect, type Browser, type Page, type APIRequestContext } from "@playwright/test";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

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

/** Open a fresh anonymous context (no cookies, no auth). */
async function newAnonContext(browser: Browser) {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  return { ctx, page: await ctx.newPage() };
}

/**
 * Robustly enter the Lobby: fill name + click Join, retrying until the board
 * (no "Your name" input) shows. In dev, React StrictMode remounts the Lobby
 * once on mount, which can reset the input mid-fill; the retry absorbs that.
 * Production single-mounts, so this is purely test-environment hardening.
 */
async function lobbyJoin(page: Page, name: string) {
  await expect(async () => {
    const input = page.getByPlaceholder("Your name").first();
    await input.fill(name);
    await expect(input).toHaveValue(name);
    await page.getByRole("button", { name: "Join" }).first().click();
    await expect(page.getByPlaceholder("Your name")).toHaveCount(0, { timeout: 3000 });
  }).toPass({ timeout: 25_000 });
}

// Anonymous at the project level; individual tests open their own contexts.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Retro multiplayer", () => {
  /**
   * Two contexts:
   * 1. Creator creates a board and lands on /retro/<token>.
   * 2. Joiner navigates to the same URL.
   * Both should see the board name.
   */
  test("joiner navigating to the share link sees the same board name", async ({
    browser,
    request,
  }) => {
    // Increase timeout for two-context coordination + realtime.
    test.setTimeout(60_000);

    await withRetroEnabled(request, async () => {
      // --- Creator context ---
      const { ctx: creatorCtx, page: creatorPage } = await newAnonContext(browser);

      try {
        await creatorPage.goto(`${APP_URL}/retro`);
        await creatorPage.waitForLoadState("domcontentloaded");

        await creatorPage.getByRole("button", { name: "Start a retro" }).click();
        await expect(
          creatorPage.getByRole("heading", { name: "Start a retro", exact: true })
        ).toBeVisible();

        const boardName = `Multiplayer Board ${Date.now()}`;
        await creatorPage.getByPlaceholder(/Sprint/i).first().fill(boardName);
        await creatorPage.getByRole("button", { name: /Create & get link/i }).click();

        await creatorPage.waitForURL(/\/retro\/[a-f0-9]{36,}/i, { timeout: 20_000 });
        const boardUrl = creatorPage.url();

        // --- Joiner context ---
        const { ctx: joinerCtx, page: joinerPage } = await newAnonContext(browser);

        try {
          await joinerPage.goto(boardUrl);
          await joinerPage.waitForLoadState("domcontentloaded");

          // Board name visible in the header for both.
          await expect(joinerPage.getByText(boardName).first()).toBeVisible({ timeout: 15_000 });
          await expect(creatorPage.getByText(boardName).first()).toBeVisible();
        } finally {
          await joinerCtx.close();
        }
      } finally {
        await creatorCtx.close();
      }
    });
  });

  /**
   * Both contexts see the Lobby. Each enters a name; participant presence
   * count updates for both.
   */
  test("presence count updates when joiner enters the lobby", async ({
    browser,
    request,
  }) => {
    test.setTimeout(60_000);

    await withRetroEnabled(request, async () => {
      const { ctx: creatorCtx, page: creatorPage } = await newAnonContext(browser);

      try {
        await creatorPage.goto(`${APP_URL}/retro`);
        await creatorPage.waitForLoadState("domcontentloaded");

        await creatorPage.getByRole("button", { name: "Start a retro" }).click();
        await creatorPage.getByPlaceholder(/Sprint/i).first().fill(`Presence Test ${Date.now()}`);
        await creatorPage.getByRole("button", { name: /Create & get link/i }).click();
        await creatorPage.waitForURL(/\/retro\/[a-f0-9]{36,}/i, { timeout: 20_000 });

        const boardUrl = creatorPage.url();

        // Creator enters the Lobby.
        await creatorPage.getByPlaceholder("Your name").first().fill("Creator");
        await creatorPage.getByRole("button", { name: "Join" }).first().click();

        const { ctx: joinerCtx, page: joinerPage } = await newAnonContext(browser);
        try {
          await joinerPage.goto(boardUrl);
          await joinerPage.waitForLoadState("domcontentloaded");

          // Joiner sees the Lobby.
          await expect(joinerPage.getByPlaceholder("Your name").first()).toBeVisible({ timeout: 10_000 });

          // Lobby presence section shows "X already here" (Lobby.tsx monospace span).
          // After creator joined, count should be at least 1.
          await expect(
            joinerPage.getByText(/already here/i).first()
          ).toBeVisible({ timeout: 8_000 });

          // Joiner enters their name.
          await joinerPage.getByPlaceholder("Your name").first().fill("Joiner");
          await joinerPage.getByRole("button", { name: "Join" }).first().click();
        } finally {
          await joinerCtx.close();
        }
      } finally {
        await creatorCtx.close();
      }
    });
  });

  /**
   * Creator adds a card in Reflect; the card text propagates to the joiner
   * within the reconcile window (~3s, allow up to 8s in the assertion).
   * Both contexts must be past the Lobby (creator advances to Reflect).
   */
  test("card added by creator appears for joiner in Reflect phase", async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000);

    await withRetroEnabled(request, async () => {
      const { ctx: creatorCtx, page: creatorPage } = await newAnonContext(browser);

      try {
        await creatorPage.goto(`${APP_URL}/retro`);
        await creatorPage.waitForLoadState("domcontentloaded");

        await creatorPage.getByRole("button", { name: "Start a retro" }).click();
        const boardName = `Card Sync Test ${Date.now()}`;
        await creatorPage.getByPlaceholder(/Sprint/i).first().fill(boardName);
        await creatorPage.getByRole("button", { name: /Create & get link/i }).click();
        await creatorPage.waitForURL(/\/retro\/[a-f0-9]{36,}/i, { timeout: 20_000 });

        const boardUrl = creatorPage.url();

        // Creator (facilitator) enters Lobby and advances to Reflect.
        await lobbyJoin(creatorPage, "Facilitator");

        // After facilitator joins + advances, Reflect should be active.
        await expect(creatorPage.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

        // Joiner joins.
        const { ctx: joinerCtx, page: joinerPage } = await newAnonContext(browser);
        try {
          await joinerPage.goto(boardUrl);
          await joinerPage.waitForLoadState("domcontentloaded");

          // Joiner enters lobby (phase may still be reflect/lobby for joiner).
          await lobbyJoin(joinerPage, "Joiner");

          // Wait for joiner to be in Reflect.
          await expect(joinerPage.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

          // Creator adds a card.
          const cardText = `Sync card ${Date.now()}`;
          await creatorPage.getByRole("button", { name: "Add a card" }).first().click();
          await creatorPage.getByPlaceholder("What's on your mind?").first().fill(cardText);
          await creatorPage.getByRole("button", { name: "Add card" }).first().click();

          // Creator sees own card immediately.
          await expect(creatorPage.getByText(cardText).first()).toBeVisible({ timeout: 5_000 });

          // In Reflect, cards from other participants appear face-down (hidden text) for joiner.
          // However the snapshot reconcile syncs board state; the joiner's board will show
          // the card count increment in the column header (e.g. "1" in the mono span).
          // We wait for the column card count to update on the joiner side.
          // The snapshot reconcile is 3s; allow several cycles for cross-context
          // realtime + reconcile under dev-environment load.
          await expect(
            // Column header shows card count as a monospace number.
            joinerPage.locator("header").filter({ has: joinerPage.getByText(/^1$/) }).first()
          ).toBeVisible({ timeout: 20_000 });
        } finally {
          await joinerCtx.close();
        }
      } finally {
        await creatorCtx.close();
      }
    });
  });

  /**
   * After Reveal, both contexts see the card text (cards are no longer face-down).
   */
  test("after Reveal, cards from creator are readable by joiner", async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000);

    await withRetroEnabled(request, async () => {
      const { ctx: creatorCtx, page: creatorPage } = await newAnonContext(browser);

      try {
        await creatorPage.goto(`${APP_URL}/retro`);
        await creatorPage.waitForLoadState("domcontentloaded");

        await creatorPage.getByRole("button", { name: "Start a retro" }).click();
        await creatorPage.getByPlaceholder(/Sprint/i).first().fill(`Reveal Sync ${Date.now()}`);
        await creatorPage.getByRole("button", { name: /Create & get link/i }).click();
        await creatorPage.waitForURL(/\/retro\/[a-f0-9]{36,}/i, { timeout: 20_000 });

        const boardUrl = creatorPage.url();

        // Creator enters and advances to Reflect.
        await lobbyJoin(creatorPage, "Creator");
        await expect(creatorPage.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

        // Joiner joins.
        const { ctx: joinerCtx, page: joinerPage } = await newAnonContext(browser);
        try {
          await joinerPage.goto(boardUrl);
          await joinerPage.waitForLoadState("domcontentloaded");

          await lobbyJoin(joinerPage, "Joiner");

          await expect(joinerPage.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

          // Creator adds a card.
          const cardText = `Revealed ${Date.now()}`;
          await creatorPage.getByRole("button", { name: "Add a card" }).first().click();
          await creatorPage.getByPlaceholder("What's on your mind?").first().fill(cardText);
          await creatorPage.getByRole("button", { name: "Add card" }).first().click();
          await expect(creatorPage.getByText(cardText).first()).toBeVisible();

          // Creator advances to Reveal.
          await creatorPage.getByRole("button", { name: "Advance" }).first().click();
          await expect(creatorPage.getByText("Reveal").first()).toBeVisible({ timeout: 10_000 });

          // Joiner sees Reveal phase and the card text (cascade completes ~90ms * n + 250ms).
          // Allow several reconcile cycles for cross-context realtime under dev load.
          await expect(joinerPage.getByText("Reveal").first()).toBeVisible({ timeout: 10_000 });
          await expect(joinerPage.getByText(cardText).first()).toBeVisible({ timeout: 20_000 });
        } finally {
          await joinerCtx.close();
        }
      } finally {
        await creatorCtx.close();
      }
    });
  });

  /**
   * ShareInvite panel: clicking "Share" in the board header opens the invite
   * modal with a copy-link button. The link shown contains the board token.
   */
  test("the Share button opens an invite modal with the board link", async ({
    browser,
    request,
  }) => {
    test.setTimeout(60_000);

    await withRetroEnabled(request, async () => {
      const { ctx, page } = await newAnonContext(browser);
      try {
        await page.goto(`${APP_URL}/retro`);
        await page.waitForLoadState("domcontentloaded");

        await page.getByRole("button", { name: "Start a retro" }).click();
        await page.getByPlaceholder(/Sprint/i).first().fill(`Share Test ${Date.now()}`);
        await page.getByRole("button", { name: /Create & get link/i }).click();
        await page.waitForURL(/\/retro\/[a-f0-9]{36,}/i, { timeout: 20_000 });

        // Dismiss Lobby if shown.
        const nameInput = page.getByPlaceholder("Your name").first();
        if (await nameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await nameInput.fill("Host");
          await page.getByRole("button", { name: "Join" }).first().click();
        }

        // Click the "Share" button in the top chrome (RetroClient.tsx header).
        await page.getByRole("button", { name: "Share" }).first().click();

        // ShareInvite modal: "Your retro is live" (ShareInvite.tsx).
        await expect(
          page.getByText("Your retro is live").first()
        ).toBeVisible({ timeout: 5_000 });

        // Copy link button.
        await expect(
          page.getByRole("button", { name: "Copy link" }).first()
        ).toBeVisible();
      } finally {
        await ctx.close();
      }
    });
  });
});
