# Retro: properly ending a session (the "Stop the retro" fix)

Date: 2026-06-19
Status: Approved design, ready for implementation plan
Area: Minutia Retro (`src/components/retro/*`, `src/app/(retro)/*`, `src/lib/retro/*`, `supabase/migrations/*`)

## Problem

After a retro reaches its end, the facilitator cannot actually *stop* it. Symptoms reported repeatedly (this is a recurring, never-fully-fixed bug):

- The phase timer runs away forever (observed at `2325:37`).
- "Just export markdown" is a dead end — it downloads a file and changes no state, leaving the user on the identical nudge with no closure.
- Saving to Minutia shows "Open the series" but the board stays live: still polling, presence still tracked, still editable.

### Root cause

The product has **no concept of "the session is over."** `seal()` only flips `phase → 'closed'`, which swaps the Commit panel to a save/export nudge:

- `RetroClient.tsx:125-128` runs a `setNow(Date.now())` interval forever; `timer` (`RetroClient.tsx:137-144`) is still computed and rendered while `phase === 'closed'`, with no active phase to time — so it climbs without bound.
- `exportMarkdown()` (`RetroClient.tsx:277-287`) mutates zero state.
- Nothing locks the board, freezes the timer, or tears down presence/polling.

## Decision (approved)

Introduce **one new explicit terminal state, distinct from "sealed."** Two milestones:

| Milestone | Trigger | Meaning |
|---|---|---|
| **Sealed** | facilitator clicks *Seal these decisions* (`seal()`) | `phase='closed'`. Decisions locked, timer hidden, save/export funnel opens. (Existing behavior, minus the runaway timer.) |
| **Ended** *(new)* | facilitator clicks *End retro* → confirms | `ended_at` set. Board archived: read-only static summary, presence + polling torn down, live mutation rejected for everyone. |

Approved choices:
- **Full close**: end session, freeze timer, lock board read-only, disconnect presence, archive so the link resolves to a static summary.
- **Separate "End retro" button**, surfaced only *after* the user has saved to Minutia **or** exported markdown. Ending is facilitator-only (it ends for everyone).
- **Confirm dialog** before ending (styled modal, not a raw `alert()`).

### Why a new column, not a new phase value

`ended_at timestamptz` is a new column, **not** a new `phase` enum value. The phase enum is mirrored across `src/lib/retro/phases.ts` ↔ the SQL `CHECK` constraint ↔ `scripts/verify-retro-contracts.test.mjs`. Adding a phase risks three-way drift; a column does not. `ended_at` also doubles as the natural "session over" boolean and freeze timestamp. `phase='closed'` (sealed) and `ended_at` (ended) are sequential, orthogonal facts.

## Changes by layer

### 1. SQL — new migration `supabase/migrations/<ts>_retro_end.sql`

- `alter table public.retro_boards add column ended_at timestamptz;`
- New internal helper `_retro_assert_live(b public.retro_boards)`: raises `retro: board ended` (errcode `42501` or similar non-retryable) when `b.ended_at is not null`. Revoke execute from `public, anon, authenticated` like the other `_retro_*` helpers.
- New RPC `retro_end(p_ftoken text)`:
  - `_retro_assert_facilitator(p_ftoken)`.
  - Require `phase = 'closed'` (must seal first); else raise `retro: not sealed` (`22000`).
  - **Idempotent**: if `ended_at is not null`, return `{ok:true, already_ended:true}` without re-writing.
  - Else `update retro_boards set ended_at = now(), updated_at = now()`; return `{ok:true, ended_at:<ts>}`.
  - `grant execute ... to anon, authenticated`.
- Add `'ended_at', b.ended_at` to the board object in `retro_snapshot`. `retro_snapshot` must **still return** ended boards (the summary loads from it) — so it does **not** call `_retro_assert_live`.
- Call `_retro_assert_live(b)` from every mutation RPC, after the board is loaded: `retro_add_card`, `retro_update_card`, `retro_delete_card`, `retro_vote`, `retro_set_card_group`, `retro_set_phase`, `retro_add_action`, `retro_update_action`, `retro_delete_action`. (`retro_join` may stay open so a late viewer can still register presence-less; prefer to also block it for a fully frozen room — block it.)

### 2. Types — `src/lib/retro/types.ts`

- `RetroSnapshot.board.ended_at: string | null`.
- Add to `RetroBroadcast` union: `{ t: "retro.ended"; ended_at: string }`.

### 3. Hooks — `src/lib/hooks/use-retro.ts`, `src/lib/retro/apply-event.ts`

- `useRetroSnapshot(token, meKey?, initialData?, live = true)`: `refetchInterval: live ? 3000 : false`. Stop polling once ended.
- `useRetroChannel(...)`: accept an `enabled` flag; when ended, skip `channel.subscribe()` / `track()` so presence is torn down. (Existing cleanup already calls `removeChannel`.)
- `applyRetroEvent`: handle `retro.ended` → set `board.ended_at` from the payload so peers flip to the summary immediately, before their channel tears down.

### 4. `src/app/(retro)/retro/[token]/RetroClient.tsx`

- `const ended = !!board.ended_at;`
- Timer: pass `timer={sealed || ended ? null : timer}` to `PhaseBar`, and stop the `setNow` interval when `sealed || ended`. **This single change retroactively fixes the runaway timer on every already-`closed` board in the wild.**
- Gate the live channel + polling on `!ended` (pass `live`/`enabled`).
- New `exported` state set `true` inside `exportMarkdown()`.
- New `endRetro()`: `rpc('retro_end', { p_ftoken: ftoken })` with optimistic `board.ended_at` patch and broadcast `{ t: 'retro.ended', ended_at }`.
- When `ended`, render `<RetroSummary>` instead of Lobby / Board / CommitPanel.

### 5. `src/components/retro/CommitPanel.tsx` + new `src/components/retro/ConfirmDialog.tsx`

- New props on CommitPanel: `canEnd: boolean` (`sealed && isFacilitator && (savedSeriesId || exported)`), `onEnd: () => void`.
- When `canEnd`, render an **"End retro"** button: copy ~ "Everyone done? End the retro to lock the board for everyone."
- Clicking opens `ConfirmDialog`: *"This ends the retro for everyone. The board becomes read-only and live editing stops. This can't be undone."* If exported-only (never saved), add a warning line that the board still expires in 30 days. Confirm → `onEnd()`.
- `ConfirmDialog` is a small reusable styled modal matching `CardEditor`/`ShareInvite` conventions (no raw `alert`/`confirm`).

### 6. New `src/components/retro/RetroSummary.tsx`

Frozen read-only view rendered when `ended`:
- Header: "Retro complete" + board name.
- Columns + cards, read-only (no add/edit affordances).
- The sealed action items.
- Post-actions: *Open the series →* (when `savedSeriesId`); *Export markdown* (always, reuses `boardToMarkdown`).
- No phase bar, no editors, no presence stack, no share-to-join.

### 7. Server loader — `src/app/(retro)/retro/[token]/page.tsx`

No change required: SSR snapshot now carries `ended_at`, and `RetroClient` renders the summary client-side from `initialSnapshot`, so an ended link resolves straight to the static summary. (Do not add a separate SSR summary page — same result, less code.)

## Testing (TDD; write the failing test first)

### Contract / RPC (Vitest + local Supabase, mirror existing `verify-retro-contracts`)
- `retro_end` is facilitator-only: bad/missing ftoken → `42501`.
- `retro_end` rejects when `phase != 'closed'` → `22000`.
- `retro_end` is idempotent: second call returns `already_ended:true`, `ended_at` unchanged.
- Once `ended_at` set, each mutation RPC (`add_card`, `update_card`, `delete_card`, `vote`, `set_card_group`, `set_phase`, `add/update/delete_action`, `join`) raises.
- `retro_snapshot` still returns an ended board, with `ended_at` populated.
- Update `scripts/verify-retro-contracts.test.mjs` for the new RPC name + the new snapshot field.

### Unit
- `applyRetroEvent` applies `retro.ended` (sets `board.ended_at`).
- Timer hidden when `sealed || ended`; `setNow` interval not scheduling when ended.

### e2e (extend `e2e/regression/retro-ritual.spec.ts` and/or `retro-graduate.spec.ts`)
- Seal → export → *End retro* appears → confirm → summary renders, timer gone, board read-only.
- A second (peer) browser context flips to the summary on `retro.ended`.
- Save-path variant: seal → save to Minutia → End retro → summary with "Open the series".
- Late joiner: open an already-ended token → lands directly on the summary, no live channel.

## Edge cases (enumerated per branch)
- End before seal → RPC rejects; button hidden anyway (`canEnd` false).
- Double end → idempotent; no harmful re-broadcast.
- Non-facilitator attempts end → `42501`; button hidden for non-facilitators.
- Export-only then end → confirm dialog warns the board still expires in 30 days (only saving exempts expiry).
- Peer ordering → `retro.ended` arrives on the still-open channel and is applied before that peer's teardown runs.
- Already-`closed` boards already in production → timer-hide on `sealed` fixes them retroactively with no migration backfill.
- Saved board (`saved_to_series_id` set) then ended → independent; summary shows series link.

## Out of scope
- "Un-end"/reopen (ending is explicitly irreversible per the confirm copy).
- Reworking the per-phase timer semantics for active phases (unchanged).
- Letting non-facilitators save/export (existing behavior left as-is).
