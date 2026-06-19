/**
 * retro-ritual.spec.ts
 *
 * Single-context tests for the facilitator-led 5-phase ritual:
 * Lobby -> Reflect -> Reveal & Vote -> Discuss -> Commit.
 * (Reveal, theme, and dot-voting are merged into one "Reveal & Vote" phase.)
 *
 * Assumption: `retro_enabled = 'true'` in instance_config. Each test uses
 * `withRetroEnabled` to set the flag and restore it, requiring SERVICE_KEY.
 *
 * The creator is automatically the facilitator (has the facilitator token in
 * localStorage). The Lobby shows immediately after creation; the facilitator
 * enters their name to advance to Reflect. Phase advances use the "Advance"
 * button in the PhaseBar (only shown to the facilitator).
 *
 * Note on timing: Supabase Realtime broadcast delivers phase changes to self
 * very quickly; snapshot reconcile runs every ~3s. Tests use a liberal
 * expectation timeout (up to 10s, Playwright default) for phase transitions.
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
    await setRetroEnabled(request, "false");
  }
}

/**
 * Helper: create a board from the landing page and navigate to it.
 * Returns the page already on /retro/<token>.
 */
async function createBoardAndNavigate(
  page: import("@playwright/test").Page,
  boardName: string
) {
  await page.goto("/retro");
  await page.waitForLoadState("domcontentloaded");

  await page.getByRole("button", { name: "Start a retro" }).click();
  await expect(
    page.getByRole("heading", { name: "Start a retro", exact: true })
  ).toBeVisible();

  await page.getByPlaceholder(/Sprint/i).first().fill(boardName);
  await page.getByRole("button", { name: /Create & get link/i }).click();
  await page.waitForURL(/\/retro\/[a-f0-9]{36,}/i, { timeout: 20_000 });
}

/**
 * The Lobby is shown when the user has not yet entered their name (needsJoin)
 * or when phase === "lobby". The facilitator enters a name and submits, which
 * calls `join` then `advance` (lobby -> reflect). The board then shows Reflect.
 */
async function enterLobby(
  page: import("@playwright/test").Page,
  facilitatorName: string
) {
  // Wait for Lobby to appear, it shows the board name in an h1.
  // The Lobby name input has placeholder "Your name".
  const nameInput = page.getByPlaceholder("Your name").first();
  await expect(nameInput).toBeVisible();
  await nameInput.fill(facilitatorName);

  // The Join button in Lobby.tsx, disabled until name has content.
  await page.getByRole("button", { name: "Join" }).first().click();
}

// Anonymous: no auth required for the ritual.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Retro ritual, facilitator flow", () => {
  test("Lobby shows the board name and a name input", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await createBoardAndNavigate(page, "Ritual Lobby Test");

      // Board header (top chrome) shows the name.
      await expect(page.getByText("Ritual Lobby Test").first()).toBeVisible();

      // Lobby form: name input.
      await expect(page.getByPlaceholder("Your name").first()).toBeVisible();

      // Lobby shows the mood picker section.
      await expect(page.getByText(/How'd this sprint feel/i).first()).toBeVisible();
    });
  });

  test("entering a name and joining advances to Reflect as facilitator", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await createBoardAndNavigate(page, "Ritual Reflect Test");

      await enterLobby(page, "Alice");

      // RetroClient advances phase to "reflect" after the facilitator joins.
      // PhaseBar shows "Reflect" as the current phase label.
      await expect(
        page.getByText("Reflect").first()
      ).toBeVisible({ timeout: 10_000 });

      // Board columns appear (at least one "Add a card" button).
      await expect(
        page.getByRole("button", { name: "Add a card" }).first()
      ).toBeVisible();
    });
  });

  test("facilitator can add a card in Reflect phase", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await createBoardAndNavigate(page, "Ritual Card Test");
      await enterLobby(page, "Bob");

      // Wait for Reflect.
      await expect(page.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

      // Click "Add a card" in the first column.
      await page.getByRole("button", { name: "Add a card" }).first().click();

      // CardEditor modal, placeholder from CardEditor.tsx.
      await expect(
        page.getByPlaceholder("What's on your mind?").first()
      ).toBeVisible();

      await page.getByPlaceholder("What's on your mind?").first().fill("We shipped on time!");
      await page.getByRole("button", { name: "Add card" }).first().click();

      // Card appears in the board (text visible).
      await expect(page.getByText("We shipped on time!").first()).toBeVisible();
    });
  });

  test("cards are hidden from self in Reflect (only-you-can-see label shown)", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await createBoardAndNavigate(page, "Ritual Private Test");
      await enterLobby(page, "Carol");

      await expect(page.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

      // Board.tsx shows "Writing privately." banner in Reflect.
      await expect(
        page.getByText("Writing privately.").first()
      ).toBeVisible();

      // After adding a card, Board shows "only you can see this" label.
      await page.getByRole("button", { name: "Add a card" }).first().click();
      await page.getByPlaceholder("What's on your mind?").first().fill("Hidden card");
      await page.getByRole("button", { name: "Add card" }).first().click();

      await expect(
        page.getByText("only you can see this").first()
      ).toBeVisible();
    });
  });

  test("facilitator Advance button is visible and advances the phase", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await createBoardAndNavigate(page, "Ritual Advance Test");
      await enterLobby(page, "Dave");

      // Wait for Reflect with Advance button (facilitator-only in PhaseBar).
      await expect(page.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });
      const advanceBtn = page.getByRole("button", { name: "Advance" }).first();
      await expect(advanceBtn).toBeVisible();

      // Advance: Reflect -> Reveal.
      await advanceBtn.click();
      await expect(page.getByText("Reveal").first()).toBeVisible({ timeout: 10_000 });
    });
  });

  test("Reveal phase shows all cards (cascade revealed) and the reveal banner", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await createBoardAndNavigate(page, "Ritual Reveal Test");
      await enterLobby(page, "Eve");

      await expect(page.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

      // Add a card so there is something to reveal.
      await page.getByRole("button", { name: "Add a card" }).first().click();
      await page.getByPlaceholder("What's on your mind?").first().fill("Revealed card text");
      await page.getByRole("button", { name: "Add card" }).first().click();

      // Advance to Reveal.
      await page.getByRole("button", { name: "Advance" }).first().click();

      // Board.tsx reveals banner: "The reveal."
      await expect(page.getByText("The reveal.").first()).toBeVisible({ timeout: 10_000 });

      // The card text should become visible after the reveal cascade.
      await expect(
        page.getByText("Revealed card text").first()
      ).toBeVisible({ timeout: 10_000 });
    });
  });

  test("Reveal & Vote phase reveals cards and shows live dot-voting", async ({ page, request }) => {
    await withRetroEnabled(request, async () => {
      await createBoardAndNavigate(page, "Ritual Vote Test");
      await enterLobby(page, "Frank");

      await expect(page.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

      // Add a card.
      await page.getByRole("button", { name: "Add a card" }).first().click();
      await page.getByPlaceholder("What's on your mind?").first().fill("Vote on this");
      await page.getByRole("button", { name: "Add card" }).first().click();

      // Advance Reflect -> Reveal & Vote (the merged phase).
      await page.getByRole("button", { name: "Advance" }).first().click();
      await expect(page.getByText("Reveal & Vote").first()).toBeVisible({ timeout: 10_000 });

      // The card reveals, and a VoteTally (aria-label "Vote") renders for it.
      await expect(page.getByText("Vote on this").first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "Vote" }).first()).toBeVisible({ timeout: 10_000 });
    });
  });

  test("Commit phase shows Seal these decisions button and the Minutia nudge after sealing", async ({
    page,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await createBoardAndNavigate(page, "Ritual Commit Test");
      await enterLobby(page, "Grace");

      await expect(page.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

      // Advance through all phases to Commit.
      const advance = () =>
        page.getByRole("button", { name: "Advance" }).first().click();

      await advance(); // -> Reveal & Vote
      await expect(page.getByText("Reveal & Vote").first()).toBeVisible({ timeout: 10_000 });
      await advance(); // -> Discuss
      await expect(page.getByText("Discuss").first()).toBeVisible({ timeout: 10_000 });
      await advance(); // -> Commit
      // CommitPanel heading from CommitPanel.tsx.
      await expect(
        page.getByRole("heading", { name: "Commit the actions" })
      ).toBeVisible({ timeout: 10_000 });

      // Seal button.
      const sealBtn = page.getByRole("button", { name: "Seal these decisions" }).first();
      await expect(sealBtn).toBeVisible();
      await sealBtn.click();

      // After sealing, CommitPanel switches to "Sealed, nice work."
      // Sealing now persists phase=closed via RPC + refetch, so allow for the round-trip.
      await expect(
        page.getByRole("heading", { name: "Sealed, nice work." })
      ).toBeVisible({ timeout: 10_000 });

      // The Minutia nudge appears in the sealed CommitPanel.
      await expect(
        page.getByText("The only retro where the action items don't die.").first()
      ).toBeVisible();

      // "Just export markdown" is always free (no auth required).
      await expect(
        page.getByRole("button", { name: "Just export markdown" }).first()
      ).toBeVisible();

      // "Save to Minutia" requires auth, button present but triggers auth flow.
      await expect(
        page.getByRole("button", { name: "Save to Minutia" }).first()
      ).toBeVisible();
    });
  });

  test("facilitator sealing closes the board for participants too", async ({
    page,
    browser,
    request,
  }) => {
    await withRetroEnabled(request, async () => {
      await createBoardAndNavigate(page, "Ritual Multiplayer Seal");
      const boardUrl = page.url();
      await enterLobby(page, "Heidi"); // creator is the facilitator
      await expect(page.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });

      // A participant joins in a fresh context (no facilitator token in storage).
      const guestCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const guest = await guestCtx.newPage();
      try {
        await guest.goto(boardUrl);
        await guest.waitForLoadState("domcontentloaded");
        await enterLobby(guest, "Ivan");

        // Facilitator drives the ritual to Commit.
        const advance = () => page.getByRole("button", { name: "Advance" }).first().click();
        await advance(); // -> Reveal & Vote
        await expect(page.getByText("Reveal & Vote").first()).toBeVisible({ timeout: 10_000 });
        await advance(); // -> Discuss
        await expect(page.getByText("Discuss").first()).toBeVisible({ timeout: 10_000 });
        await advance(); // -> Commit
        await expect(
          page.getByRole("heading", { name: "Commit the actions" })
        ).toBeVisible({ timeout: 10_000 });

        // The participant follows to Commit via realtime, sees the waiting hint,
        // and is NOT offered the facilitator-only Seal button.
        await expect(
          guest.getByRole("heading", { name: "Commit the actions" })
        ).toBeVisible({ timeout: 12_000 });
        await expect(
          guest.getByText(/Waiting for the facilitator to seal/i).first()
        ).toBeVisible();
        await expect(
          guest.getByRole("button", { name: "Seal these decisions" })
        ).toHaveCount(0);

        // Facilitator seals: this persists phase=closed and broadcasts.
        await page.getByRole("button", { name: "Seal these decisions" }).first().click();
        await expect(
          page.getByRole("heading", { name: "Sealed, nice work." })
        ).toBeVisible({ timeout: 10_000 });

        // The bug under test: the participant's screen must update to sealed too.
        await expect(
          guest.getByRole("heading", { name: "Sealed, nice work." })
        ).toBeVisible({ timeout: 12_000 });
      } finally {
        await guestCtx.close();
      }
    });
  });

  // Drive a freshly created+joined board through to a sealed Commit panel. Phase
  // advances are optimistic but reconcile against the 3s poll, so each step gets a
  // wide budget to absorb a poll-cycle race over this long chain (dev-mode).
  async function sealCurrentBoard(page: import("@playwright/test").Page) {
    const advance = () => page.getByRole("button", { name: "Advance" }).first().click();
    await expect(page.getByText("Reflect").first()).toBeVisible({ timeout: 15_000 });
    await advance();
    await expect(page.getByText("Reveal & Vote").first()).toBeVisible({ timeout: 15_000 });
    await advance();
    await expect(page.getByText("Discuss").first()).toBeVisible({ timeout: 15_000 });
    await advance();
    await expect(page.getByRole("heading", { name: "Commit the actions" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Seal these decisions" }).first().click();
    await expect(page.getByRole("heading", { name: "Sealed, nice work." })).toBeVisible({ timeout: 15_000 });
  }

  test.describe("ending a retro", () => {
    test("export then End retro freezes the board to a read-only summary", async ({ page, request }) => {
      test.setTimeout(90_000);
      await withRetroEnabled(request, async () => {
        await createBoardAndNavigate(page, "Ritual End Test");
        await enterLobby(page, "Olivia");
        await sealCurrentBoard(page);

        // End retro is hidden until the user has saved OR exported.
        await expect(page.getByRole("button", { name: "End retro" })).toHaveCount(0);

        await page.getByRole("button", { name: "Just export markdown" }).first().click();

        // End retro now appears; clicking opens the styled confirm (not window.confirm).
        const endBtn = page.getByRole("button", { name: "End retro" }).first();
        await expect(endBtn).toBeVisible();
        await endBtn.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByText("End this retro?")).toBeVisible();
        // Export-only path warns about the 30-day expiry.
        await expect(dialog.getByText(/expires in 30 days/i)).toBeVisible();
        await dialog.getByRole("button", { name: "End retro" }).click();

        // Frozen summary renders; phase bar and its timer are gone.
        await expect(page.getByText("Retro complete").first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("This board is read-only. Live editing has ended.").first()).toBeVisible();
        await expect(page.getByRole("button", { name: "Advance" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Add a card" })).toHaveCount(0);
        // Export is still offered on the summary.
        await expect(page.getByRole("button", { name: "Export markdown" }).first()).toBeVisible();
      });
    });

    test("ending the retro flips a peer to the summary", async ({ page, browser, request }) => {
      test.setTimeout(120_000);
      await withRetroEnabled(request, async () => {
        await createBoardAndNavigate(page, "Ritual End Peer");
        const boardUrl = page.url();
        await enterLobby(page, "Quinn"); // facilitator

        const guestCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const guest = await guestCtx.newPage();
        try {
          // The peer need not join: the `ended` view precedes the lobby gate, so an
          // unjoined peer still flips to the summary. Waiting for its lobby just
          // proves the cold context has loaded its live channel + poll.
          await guest.goto(boardUrl);
          await guest.waitForLoadState("domcontentloaded");
          await expect(guest.getByPlaceholder("Your name").first()).toBeVisible({ timeout: 15_000 });

          await sealCurrentBoard(page);
          await page.getByRole("button", { name: "Just export markdown" }).first().click();
          await page.getByRole("button", { name: "End retro" }).first().click();
          await page.getByRole("dialog").getByRole("button", { name: "End retro" }).click();

          await expect(page.getByText("Retro complete").first()).toBeVisible({ timeout: 10_000 });
          // The peer flips to the summary (broadcast, with the 3s poll as backstop).
          await expect(guest.getByText("Retro complete").first()).toBeVisible({ timeout: 15_000 });
          await expect(guest.getByRole("button", { name: "Add a card" })).toHaveCount(0);
        } finally {
          await guestCtx.close();
        }
      });
    });

    test("an already-ended link lands directly on the summary", async ({ page, browser, request }) => {
      test.setTimeout(120_000);
      await withRetroEnabled(request, async () => {
        await createBoardAndNavigate(page, "Ritual End LateJoiner");
        const boardUrl = page.url();
        await enterLobby(page, "Sam");
        await sealCurrentBoard(page);
        await page.getByRole("button", { name: "Just export markdown" }).first().click();
        await page.getByRole("button", { name: "End retro" }).first().click();
        await page.getByRole("dialog").getByRole("button", { name: "End retro" }).click();
        await expect(page.getByText("Retro complete").first()).toBeVisible({ timeout: 10_000 });

        // A fresh visitor opens the ended link: SSR snapshot carries ended_at, so
        // RetroClient renders the summary client-side with no lobby, no live channel.
        // Cold dev-mode bundle load on a new context is slow, hence the wider wait.
        const lateCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const late = await lateCtx.newPage();
        try {
          await late.goto(boardUrl);
          await late.waitForLoadState("domcontentloaded");
          await expect(late.getByText("Retro complete").first()).toBeVisible({ timeout: 20_000 });
          await expect(late.getByPlaceholder("Your name")).toHaveCount(0);
        } finally {
          await lateCtx.close();
        }
      });
    });
  });
});
