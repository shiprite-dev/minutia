/**
 * retro-end.spec.ts
 *
 * Contract matrix for the terminal "ended" state, exercised by calling the
 * SECURITY DEFINER RPCs directly (as the anon client does). No UI: this nails
 * the SQL behavior (facilitator-only, must-seal-first, idempotent, mutation
 * rejection, snapshot still resolves) independent of realtime timing.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

function anonHeaders() {
  return { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" };
}

async function rpc(request: APIRequestContext, fn: string, body: Record<string, unknown>) {
  return request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { headers: anonHeaders(), data: body });
}

type Board = { token: string; facilitator_token: string; board_id: string; participant_key: string };

async function createBoard(request: APIRequestContext, name: string): Promise<Board> {
  const created = await rpc(request, "retro_create", {
    p_name: name,
    p_template: "ssc",
    p_columns: [{ id: "start", title: "Start" }, { id: "stop", title: "Stop" }, { id: "continue", title: "Continue" }],
    p_facilitator_name: "Fac",
    p_facilitator_color: "sky",
    p_participant_key: `pk-${Date.now()}-${Math.floor(performance.now())}`,
  });
  expect(created.ok()).toBeTruthy();
  return created.json();
}

// Create a board and seal it (phase='closed'), the precondition for ending.
async function createSealed(request: APIRequestContext, name: string): Promise<Board> {
  const b = await createBoard(request, name);
  const sealed = await rpc(request, "retro_set_phase", { p_ftoken: b.facilitator_token, p_phase: "closed" });
  expect(sealed.ok()).toBeTruthy();
  return b;
}

test.describe("retro_end contract", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(!ANON_KEY, "Requires NEXT_PUBLIC_SUPABASE_ANON_KEY");

  test("rejects a bad facilitator token", async ({ request }) => {
    const res = await rpc(request, "retro_end", { p_ftoken: "not-a-real-token" });
    expect(res.ok()).toBeFalsy();
    expect(JSON.stringify(await res.json())).toContain("bad facilitator token");
  });

  test("rejects when the board is not sealed", async ({ request }) => {
    const b = await createBoard(request, `Unsealed ${Date.now()}`);
    const res = await rpc(request, "retro_end", { p_ftoken: b.facilitator_token });
    expect(res.ok()).toBeFalsy();
    expect(JSON.stringify(await res.json())).toContain("not sealed");
  });

  test("is idempotent: second end reports already_ended, same ended_at", async ({ request }) => {
    const b = await createSealed(request, `Idempotent ${Date.now()}`);
    const first = await rpc(request, "retro_end", { p_ftoken: b.facilitator_token });
    expect(first.ok()).toBeTruthy();
    const f = await first.json();
    expect(f.ended_at).toBeTruthy();

    const second = await rpc(request, "retro_end", { p_ftoken: b.facilitator_token });
    expect(second.ok()).toBeTruthy();
    const s = await second.json();
    expect(s.already_ended).toBe(true);
    expect(s.ended_at).toBe(f.ended_at);
  });

  test("after ending, every live-mutation RPC is rejected for everyone", async ({ request }) => {
    const b = await createSealed(request, `Frozen ${Date.now()}`);
    await rpc(request, "retro_end", { p_ftoken: b.facilitator_token });
    const FAKE = "00000000-0000-0000-0000-000000000000";

    // The guard fires on the loaded board before any per-row check, so a fake id
    // still raises "board ended" (it never reaches the ownership/existence check).
    // Member-path RPCs (token + participant key).
    const member: Array<[string, Record<string, unknown>]> = [
      ["retro_add_card", { p_token: b.token, p_key: b.participant_key, p_column: "start", p_text: "nope", p_color: "sky" }],
      ["retro_update_card", { p_token: b.token, p_key: b.participant_key, p_card: FAKE, p_text: "nope", p_color: "sky" }],
      ["retro_delete_card", { p_token: b.token, p_key: b.participant_key, p_card: FAKE }],
      ["retro_vote", { p_token: b.token, p_key: b.participant_key, p_card: FAKE, p_delta: 1 }],
      ["retro_join", { p_token: b.token, p_key: `late-${Date.now()}`, p_name: "Late", p_color: "rose" }],
    ];
    // Facilitator-path RPCs (facilitator token).
    const facilitator: Array<[string, Record<string, unknown>]> = [
      ["retro_set_phase", { p_ftoken: b.facilitator_token, p_phase: "commit" }],
      ["retro_set_card_group", { p_ftoken: b.facilitator_token, p_card_ids: [FAKE], p_group: FAKE }],
      ["retro_add_action", { p_ftoken: b.facilitator_token, p_text: "nope", p_owner: "", p_due: "", p_color: "sand" }],
      ["retro_update_action", { p_ftoken: b.facilitator_token, p_action: FAKE, p_text: "nope", p_owner: "", p_due: "" }],
      ["retro_delete_action", { p_ftoken: b.facilitator_token, p_action: FAKE }],
    ];
    for (const [fn, body] of [...member, ...facilitator]) {
      const res = await rpc(request, fn, body);
      expect(res.ok(), `${fn} should be rejected`).toBeFalsy();
      expect(JSON.stringify(await res.json()), `${fn} should report board ended`).toContain("board ended");
    }
  });

  test("snapshot still returns an ended board, with ended_at populated", async ({ request }) => {
    const b = await createSealed(request, `Snapshot ${Date.now()}`);
    await rpc(request, "retro_end", { p_ftoken: b.facilitator_token });
    const snap = await rpc(request, "retro_snapshot", { p_token: b.token, p_key: b.participant_key });
    expect(snap.ok()).toBeTruthy();
    const data = await snap.json();
    expect(data.board.ended_at).toBeTruthy();
  });

  // set_phase is monotonic forward: rapid/double "Advance" clicks fire concurrent
  // set_phase RPCs that can commit out of order; a late earlier-phase write must
  // not strand the board behind. This is the root-cause guard for the ritual flake.
  test("set_phase is monotonic: an earlier phase is a no-op, board stays ahead", async ({ request }) => {
    const b = await createBoard(request, `Monotonic ${Date.now()}`);
    for (const p of ["reflect", "reveal", "discuss", "commit"]) {
      const r = await rpc(request, "retro_set_phase", { p_ftoken: b.facilitator_token, p_phase: p });
      expect(r.ok(), `advance to ${p}`).toBeTruthy();
    }
    // A late/out-of-order request to an earlier phase is ignored (no-op).
    const back = await rpc(request, "retro_set_phase", { p_ftoken: b.facilitator_token, p_phase: "discuss" });
    expect(back.ok()).toBeTruthy();
    const backJson = await back.json();
    expect(backJson.noop).toBe(true);
    expect(backJson.phase).toBe("commit");
    // The board stayed at the highest requested phase.
    const snap = await rpc(request, "retro_snapshot", { p_token: b.token, p_key: b.participant_key });
    expect((await snap.json()).board.phase).toBe("commit");
  });
});
