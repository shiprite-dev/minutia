# Retro End Session ("Stop the retro") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the facilitator a real way to *end* a retro: freeze the timer, lock the board read-only, tear down presence/polling, and resolve the link to a static summary.

**Architecture:** Introduce one new terminal fact, `retro_boards.ended_at timestamptz`, orthogonal to the existing `phase='closed'` (sealed). A new `_retro_assert_live(b)` guard rejects every live-mutation RPC once `ended_at` is set; a new idempotent `retro_end(p_ftoken)` RPC sets it. `retro_snapshot` keeps returning ended boards (it carries `ended_at`) so the summary loads. The client flips to a frozen `RetroSummary` when `board.ended_at` is set; the single highest-leverage line (`timer={sealed || ended ? null : timer}` + stopping the `setNow` interval when sealed/ended) retroactively fixes the runaway `2325:37` timer on every already-closed board.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (Postgres SECURITY DEFINER RPCs, Realtime broadcast/presence), TanStack Query, Playwright e2e, `node:test` + esbuild contract verifier.

## Global Constraints

- No em-dashes anywhere (code, comments, commits, copy). Use commas, periods, semicolons, colons, parentheses.
- Least code for the same functionality; surgical edits, no rewrites; no abstractions with one consumer.
- `ended_at` is a NEW COLUMN, not a new `phase` enum value (avoids the phases.ts <-> SQL CHECK <-> verify-contracts three-way mirror drift).
- New migrations only; never edit a committed migration. New file: `supabase/migrations/20260619090000_retro_end.sql`.
- All table access stays via SECURITY DEFINER RPCs; tables are default-deny. Internal `_retro_*` helpers must be revoked from `public, anon, authenticated`.
- `retro_snapshot` must STILL return ended boards (it must NOT call `_retro_assert_live`).
- Ending is facilitator-only and irreversible (no un-end). Confirm via a styled modal, never a raw `alert`/`confirm`.
- The "End retro" button surfaces only after the user has saved to Minutia OR exported markdown.
- Backward compatibility: `useRetroSnapshot` / `useRetroChannel` gain new params with defaults; `RetroClient` is the only consumer (verify with grep before editing).

---

## File Structure

- `supabase/migrations/20260619090000_retro_end.sql` (create): `ended_at` column, `_retro_assert_live` helper, `retro_end` RPC, `retro_snapshot` redefined with `ended_at`, all 9 mutation RPCs + `retro_join` redefined to call `_retro_assert_live`, grants/revokes.
- `src/lib/retro/types.ts` (modify): `RetroSnapshot.board.ended_at`, `RetroBroadcast` gains `retro.ended`.
- `src/lib/retro/apply-event.ts` (modify): handle `retro.ended`.
- `src/lib/hooks/use-retro.ts` (modify): `useRetroSnapshot(..., live=true)` gates polling; `useRetroChannel(..., enabled=true)` gates subscribe/track.
- `src/app/(retro)/retro/[token]/RetroClient.tsx` (modify): `ended` flag, timer freeze, gated channel/poll, `exported` state, `endRetro()`, summary layout.
- `src/components/retro/CommitPanel.tsx` (modify): `canEnd`/`onEnd` props, "End retro" button + confirm wiring.
- `src/components/retro/ConfirmDialog.tsx` (create): reusable styled modal.
- `src/components/retro/RetroSummary.tsx` (create): frozen read-only summary.
- `scripts/verify-retro-contracts.test.mjs` (modify): `applyRetroEvent` retro.ended unit + SQL-text contract guards for the new migration.
- `e2e/regression/retro-end.spec.ts` (create): direct anon-RPC contract matrix (facilitator-only, not-sealed, idempotent, mutation-after-ended, snapshot-still-returns).
- `e2e/regression/retro-ritual.spec.ts` (modify): UI flow (seal -> export -> End retro -> summary, timer gone, read-only), peer-flip, late-joiner, save-path.

## Testing strategy (why these layers)

The repo has NO Vitest-against-DB or React component test harness. Its retro coverage is: (1) `verify-retro-contracts.test.mjs` = pure logic + SQL-text drift guards via `node:test`+esbuild, no DB; (2) Playwright e2e against the running app + local Supabase. This plan honors that split:
- Pure reducer behavior (`applyRetroEvent` retro.ended) and SQL-shape contracts -> `verify-retro-contracts.test.mjs`.
- RPC runtime behavior (error codes, idempotency, mutation rejection, snapshot) -> direct anon-RPC e2e (`retro-end.spec.ts`).
- UI behavior (summary, frozen timer, peer flip, late joiner) -> `retro-ritual.spec.ts`.
The "timer hidden / setNow not scheduling" unit item from the spec is covered behaviorally by e2e (no component-unit harness exists; adding one violates least-code).

---

### Task 1: SQL migration (ended_at column, _retro_assert_live, retro_end, guarded RPCs)

**Files:**
- Create: `supabase/migrations/20260619090000_retro_end.sql`
- Test: `scripts/verify-retro-contracts.test.mjs` (SQL-text guards)

**Interfaces:**
- Produces (SQL surface consumed by later tasks):
  - Column `public.retro_boards.ended_at timestamptz` (nullable).
  - `public._retro_assert_live(b public.retro_boards) returns void` — raises `retro: board ended` errcode `42501` when `b.ended_at is not null`. Revoked from public/anon/authenticated.
  - `public.retro_end(p_ftoken text) returns jsonb` — facilitator-only; requires `phase='closed'` else raises `retro: not sealed` (`22000`); idempotent (`{ok:true, already_ended:true}` if already ended, no re-write); else sets `ended_at=now()` and returns `{ok:true, ended_at:<iso>}`. Granted to anon, authenticated.
  - `public.retro_snapshot(p_token, p_key)` board object now includes `'ended_at', b.ended_at`. Still returns ended boards (no `_retro_assert_live` call).
  - These RPCs now reject when `ended_at` set: `retro_join`, `retro_add_card`, `retro_update_card`, `retro_delete_card`, `retro_vote`, `retro_set_card_group`, `retro_set_phase`, `retro_add_action`, `retro_update_action`, `retro_delete_action`.

- [ ] **Step 1: Write the failing SQL-text contract guards**

Add to `scripts/verify-retro-contracts.test.mjs` (after the existing `migrationPhaseSets` helper and tests). Reads the new migration as text and asserts its shape:

```javascript
function endMigration() {
  return fs.readFileSync("supabase/migrations/20260619090000_retro_end.sql", "utf8");
}

// Every RPC that mutates a live board must call _retro_assert_live(b) so an
// ended board is frozen for everyone. retro_snapshot is deliberately excluded
// (the summary still loads from it). Guards against a future RPC skipping it.
const LIVE_GUARDED_RPCS = [
  "retro_join", "retro_add_card", "retro_update_card", "retro_delete_card",
  "retro_vote", "retro_set_card_group", "retro_set_phase",
  "retro_add_action", "retro_update_action", "retro_delete_action",
];

function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start === -1) return null;
  const after = sql.indexOf("create or replace function public.", start + 1);
  return sql.slice(start, after === -1 ? undefined : after);
}

test("retro_end migration: adds ended_at column, helper, and idempotent RPC", () => {
  const sql = endMigration();
  assert.match(sql, /alter table public\.retro_boards\s+add column[\s\S]*ended_at\s+timestamptz/i);
  assert.match(sql, /create or replace function public\._retro_assert_live\s*\(/i);
  assert.match(sql, /create or replace function public\.retro_end\s*\(\s*p_ftoken text\s*\)/i);
  // retro_end must be idempotent and gate on the sealed phase.
  const end = fnBody(sql, "retro_end");
  assert.ok(end, "retro_end function present");
  assert.match(end, /already_ended/);
  assert.match(end, /'closed'/);
});

test("retro_end migration: snapshot returns ended_at and never asserts live", () => {
  const sql = endMigration();
  const snap = fnBody(sql, "retro_snapshot");
  assert.ok(snap, "retro_snapshot redefined");
  assert.match(snap, /'ended_at',\s*b\.ended_at/i);
  assert.doesNotMatch(snap, /_retro_assert_live/);
});

test("retro_end migration: every live-mutation RPC asserts the board is live", () => {
  const sql = endMigration();
  for (const name of LIVE_GUARDED_RPCS) {
    const body = fnBody(sql, name);
    assert.ok(body, `${name} redefined in the end migration`);
    assert.match(body, /_retro_assert_live\s*\(\s*b\s*\)/, `${name} must call _retro_assert_live(b)`);
  }
});

test("retro_end migration: helper revoked from anon, RPC granted to anon", () => {
  const sql = endMigration();
  assert.match(sql, /revoke[\s\S]*_retro_assert_live[\s\S]*from[\s\S]*anon/i);
  assert.match(sql, /grant execute on function[\s\S]*public\.retro_end\(text\)[\s\S]*to anon/i);
});
```

- [ ] **Step 2: Run the guards, verify they fail**

Run: `pnpm test:retro`
Expected: FAIL — `ENOENT ... 20260619090000_retro_end.sql` (migration not created yet).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260619090000_retro_end.sql`. The mutation RPCs are redefined verbatim from `20260616091000_retro_rpcs.sql` with one added `perform public._retro_assert_live(b);` line after the board is loaded; `retro_set_phase` is redefined from `20260617090000_retro_merge_phases.sql` (its later definition). `create or replace function` preserves existing grants, so only the new `retro_end` needs a fresh grant and only the new helper needs a revoke.

```sql
-- Minutia Retro: the terminal "ended" state. Distinct from "sealed" (phase='closed').
-- ended_at freezes the board: timer stops, presence/polling tear down, live
-- mutation is rejected for everyone, and the link resolves to a static summary.
-- A column (not a phase value) avoids the phases.ts <-> CHECK <-> verifier mirror.

alter table public.retro_boards add column ended_at timestamptz;

-- Internal guard: reject live mutation once the board is ended. Non-retryable.
-- retro_snapshot deliberately does NOT call this (the summary still loads).
create or replace function public._retro_assert_live(b public.retro_boards)
returns void language plpgsql security definer set search_path = public as $$
begin
  if b.ended_at is not null then
    raise exception 'retro: board ended' using errcode = '42501';
  end if;
end $$;

-- END (facilitator). Must seal first (phase='closed'). Idempotent: a second call
-- is a no-op that reports already_ended without re-writing ended_at.
create or replace function public.retro_end(p_ftoken text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  if b.phase <> 'closed' then
    raise exception 'retro: not sealed' using errcode = '22000';
  end if;
  if b.ended_at is not null then
    return jsonb_build_object('ok', true, 'already_ended', true, 'ended_at', b.ended_at);
  end if;
  update public.retro_boards set ended_at = now(), updated_at = now() where id = b.id
    returning ended_at into b.ended_at;
  return jsonb_build_object('ok', true, 'ended_at', b.ended_at);
end $$;

-- SNAPSHOT: add ended_at to the board object. Still returns ended boards so the
-- summary can load. (Redefined verbatim from 20260616091000 plus 'ended_at'.)
create or replace function public.retro_snapshot(p_token text, p_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; hide boolean;
begin
  b := public._retro_live_board(p_token);
  hide := (b.phase = 'reflect');
  return jsonb_build_object(
    'board', jsonb_build_object('id', b.id, 'name', b.name, 'template', b.template,
      'columns', b.columns, 'phase', b.phase, 'phase_started_at', b.phase_started_at,
      'settings', b.settings, 'saved_to_series_id', b.saved_to_series_id,
      'expires_at', b.expires_at, 'ended_at', b.ended_at),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('participant_key', participant_key,
      'name', name, 'color', color, 'is_facilitator', is_facilitator) order by created_at)
      from public.retro_participants where board_id = b.id), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'column_id', column_id,
      'author_key', case when hide and author_key is distinct from p_key then null else author_key end,
      'author_name', case when hide and author_key is distinct from p_key then '' else author_name end,
      'color', color,
      'text', case when hide and author_key is distinct from p_key then '' else text end,
      'group_id', group_id, 'sort_order', sort_order) order by sort_order, created_at)
      from public.retro_cards where board_id = b.id), '[]'::jsonb),
    'votes', coalesce((select jsonb_object_agg(card_id, n) from (
      select card_id, count(*) n from public.retro_votes where board_id = b.id group by card_id) t), '{}'::jsonb),
    'my_votes', coalesce((select jsonb_agg(card_id) from public.retro_votes
      where board_id = b.id and voter_key = p_key), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'text', text, 'owner_name', owner_name,
      'due', due, 'color', color, 'graduated_issue_id', graduated_issue_id) order by sort_order, created_at)
      from public.retro_actions where board_id = b.id), '[]'::jsonb),
    'carryover', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text, 'done', false))
      from public.retro_actions a where a.board_id = b.previous_board_id and a.graduated_issue_id is null), '[]'::jsonb)
  );
end $$;

-- Re-define every live-mutation RPC to assert the board is live after loading it.
-- (Bodies copied from 20260616091000_retro_rpcs.sql / 20260617090000 with one
--  added _retro_assert_live(b) call; create or replace preserves grants.)

create or replace function public.retro_join(p_token text, p_key text, p_name text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_live(b);
  if (select count(*) from public.retro_participants where board_id = b.id) >= 25
     and not exists (select 1 from public.retro_participants where board_id = b.id and participant_key = p_key) then
    raise exception 'retro: board full' using errcode = '53400';
  end if;
  insert into public.retro_participants (board_id, participant_key, name, color)
    values (b.id, p_key, left(p_name, 40), p_color)
    on conflict (board_id, participant_key) do update set name = excluded.name, color = excluded.color, last_seen_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_add_card(p_token text, p_key text, p_column text, p_text text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; c public.retro_cards; nm text;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_live(b); perform public._retro_assert_member(b.id, p_key);
  if char_length(coalesce(p_text,'')) = 0 or char_length(p_text) > 280 then
    raise exception 'retro: invalid card text' using errcode = '22000'; end if;
  if (select count(*) from public.retro_cards where board_id = b.id) >= 200 then
    raise exception 'retro: card limit' using errcode = '53400'; end if;
  if (select count(*) from public.retro_cards where board_id = b.id and author_key = p_key
      and created_at > now() - interval '1 minute') >= 12 then
    raise exception 'retro: slow down' using errcode = '53400'; end if;
  select name into nm from public.retro_participants where board_id = b.id and participant_key = p_key;
  insert into public.retro_cards (board_id, column_id, author_key, author_name, color, text)
    values (b.id, p_column, p_key, coalesce(nm,''), p_color, p_text) returning * into c;
  return to_jsonb(c);
end $$;

create or replace function public.retro_update_card(p_token text, p_key text, p_card uuid, p_text text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_live(b); perform public._retro_assert_member(b.id, p_key);
  if char_length(coalesce(p_text,'')) = 0 or char_length(p_text) > 280 then
    raise exception 'retro: invalid card text' using errcode = '22000'; end if;
  update public.retro_cards set text = p_text, color = p_color, updated_at = now()
    where id = p_card and board_id = b.id and author_key = p_key;
  if not found then raise exception 'retro: not your card' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_delete_card(p_token text, p_key text, p_card uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_live(b); perform public._retro_assert_member(b.id, p_key);
  delete from public.retro_cards where id = p_card and board_id = b.id and author_key = p_key;
  if not found then raise exception 'retro: not your card' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_vote(p_token text, p_key text, p_card uuid, p_delta int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_live(b); perform public._retro_assert_member(b.id, p_key);
  if p_delta not in (1, -1) then raise exception 'retro: invalid delta' using errcode = '22000'; end if;
  if p_delta > 0 then
    if (select count(*) from public.retro_votes where board_id = b.id and voter_key = p_key) >= 6 then
      raise exception 'retro: out of votes' using errcode = '53400'; end if;
    insert into public.retro_votes (board_id, card_id, voter_key) values (b.id, p_card, p_key)
      on conflict (board_id, card_id, voter_key) do nothing;
  else
    delete from public.retro_votes where board_id = b.id and card_id = p_card and voter_key = p_key;
  end if;
  return jsonb_build_object('count', (select count(*) from public.retro_votes where board_id = b.id and card_id = p_card));
end $$;

create or replace function public.retro_set_card_group(p_ftoken text, p_card_ids uuid[], p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken); perform public._retro_assert_live(b);
  if coalesce(array_length(p_card_ids, 1), 0) > 200 then
    raise exception 'retro: too many cards' using errcode = '22000'; end if;
  update public.retro_cards set group_id = p_group, updated_at = now()
    where board_id = b.id and id = any(p_card_ids);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_set_phase(p_ftoken text, p_phase text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken); perform public._retro_assert_live(b);
  if p_phase not in ('lobby', 'reflect', 'reveal', 'discuss', 'commit', 'closed') then
    raise exception 'retro: bad phase' using errcode = '22000'; end if;
  update public.retro_boards set phase = p_phase, phase_started_at = now(), updated_at = now() where id = b.id;
  return jsonb_build_object('ok', true, 'phase', p_phase);
end $$;

create or replace function public.retro_add_action(p_ftoken text, p_text text, p_owner text, p_due text, p_color text, p_source uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; a public.retro_actions;
begin
  b := public._retro_assert_facilitator(p_ftoken); perform public._retro_assert_live(b);
  insert into public.retro_actions (board_id, text, owner_name, due, color, source_card_id)
    values (b.id, left(p_text,280), left(coalesce(p_owner,''),80), left(coalesce(p_due,''),40), coalesce(p_color,'sand'), p_source)
    returning * into a;
  return to_jsonb(a);
end $$;

create or replace function public.retro_update_action(p_ftoken text, p_action uuid, p_text text, p_owner text, p_due text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken); perform public._retro_assert_live(b);
  update public.retro_actions set text = left(p_text,280), owner_name = left(coalesce(p_owner,''),80), due = left(coalesce(p_due,''),40)
    where id = p_action and board_id = b.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_delete_action(p_ftoken text, p_action uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken); perform public._retro_assert_live(b);
  delete from public.retro_actions where id = p_action and board_id = b.id;
  return jsonb_build_object('ok', true);
end $$;

-- New helper is internal only; new public RPC is granted to clients.
revoke all on function public._retro_assert_live(public.retro_boards) from public, anon, authenticated;
grant execute on function public.retro_end(text) to anon, authenticated;
```

- [ ] **Step 4: Apply the migration to local Supabase**

Run: `npx supabase migration up` (or `npx supabase db reset` if `up` complains about ordering).
Expected: applies cleanly, no errors.

- [ ] **Step 5: Run the SQL-text guards, verify they pass**

Run: `pnpm test:retro`
Expected: PASS (all four new tests green; existing tests still green).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260619090000_retro_end.sql scripts/verify-retro-contracts.test.mjs
git commit -m "feat(retro): ended_at terminal state, retro_end RPC, _retro_assert_live guard"
```

---

### Task 2: Types (ended_at on snapshot, retro.ended broadcast) + applyRetroEvent

**Files:**
- Modify: `src/lib/retro/types.ts`
- Modify: `src/lib/retro/apply-event.ts`
- Test: `scripts/verify-retro-contracts.test.mjs`

**Interfaces:**
- Consumes: `RetroSnapshot`, `RetroBroadcast` from Task 0 (existing).
- Produces:
  - `RetroSnapshot.board.ended_at: string | null`.
  - `RetroBroadcast` union member `{ t: "retro.ended"; ended_at: string }`.
  - `applyRetroEvent(snap, {t:"retro.ended", ended_at}, viewerKey)` returns a new snapshot with `board.ended_at` set; no-ops (same ref) if already set to that value.

- [ ] **Step 1: Write the failing unit test**

Add to `scripts/verify-retro-contracts.test.mjs` (the `baseSnap` fixture already has `board.ended_at` absent; that is fine — the reducer sets it):

```javascript
test("applyRetroEvent: retro.ended sets board.ended_at (new ref), no-ops when unchanged", () => {
  const s = baseSnap();
  const ts = "2026-06-19T10:00:00.000Z";
  const n = applyRetroEvent(s, { t: "retro.ended", ended_at: ts }, null);
  assert.equal(n.board.ended_at, ts);
  assert.notEqual(n, s);
  // Re-applying the same ended_at is a no-op (same ref -> caller skips refetch).
  assert.equal(applyRetroEvent(n, { t: "retro.ended", ended_at: ts }, null), n);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test:retro`
Expected: FAIL — `retro.ended` falls through to `default` (returns same ref), so `assert.notEqual(n, s)` fails.

- [ ] **Step 3: Add the type**

In `src/lib/retro/types.ts`, add `ended_at` to the board shape (after `expires_at: string;`):

```typescript
    expires_at: string;
    ended_at: string | null;
```

Add the broadcast member to the `RetroBroadcast` union (after `carry.toggled`):

```typescript
  | { t: "carry.toggled"; id: string }
  | { t: "retro.ended"; ended_at: string };
```

- [ ] **Step 4: Handle the event in the reducer**

In `src/lib/retro/apply-event.ts`, add a case before `default:`:

```typescript
    case "retro.ended":
      if (snap.board.ended_at === e.ended_at) return snap;
      return { ...snap, board: { ...snap.board, ended_at: e.ended_at } };
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm test:retro`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (The new non-optional `ended_at` field is supplied by the snapshot RPC; SSR `initialSnapshot` carries it. If any fixture object literal omits it, fix that literal.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/retro/types.ts src/lib/retro/apply-event.ts scripts/verify-retro-contracts.test.mjs
git commit -m "feat(retro): retro.ended broadcast type + reducer, ended_at on snapshot"
```

---

### Task 3: Hooks (gate polling and presence on liveness)

**Files:**
- Modify: `src/lib/hooks/use-retro.ts`

**Interfaces:**
- Consumes: `RetroSnapshot`, `RetroBroadcast` (Task 2).
- Produces:
  - `useRetroSnapshot(token: string, meKey?: string, initialData?: RetroSnapshot, live: boolean = true)` — `refetchInterval: live ? 3000 : false`.
  - `useRetroChannel(token, boardId, me, onPresence, onEvent?, enabled: boolean = true)` — when `enabled` is false, the subscribe/track effect early-returns; the prior cleanup (`removeChannel`) runs when `enabled` flips false (it is in the dep array), tearing down presence.

- [ ] **Step 1: Gate the snapshot poll**

In `src/lib/hooks/use-retro.ts`, change the signature and the `refetchInterval`:

```typescript
export function useRetroSnapshot(token: string, meKey?: string, initialData?: RetroSnapshot, live = true) {
  const supabase = React.useMemo(() => createClient(), []);
  return useQuery<RetroSnapshot>({
    queryKey: [...retroKeys.snapshot(token), meKey ?? null],
    initialData,
    refetchInterval: live ? 3000 : false,
```

- [ ] **Step 2: Gate the channel**

Change the `useRetroChannel` signature to add `enabled = true` as the last param:

```typescript
export function useRetroChannel(
  token: string,
  boardId: string,
  me: PresenceMeta,
  onPresence: (people: RetroParticipant[]) => void,
  onEvent?: (e: RetroBroadcast) => void,
  enabled = true
) {
```

Add `enabled` to the subscribe effect's early-return guard:

```typescript
  React.useEffect(() => {
    if (!enabled || !boardId || !me.participant_key) return;
```

Add `enabled` to that effect's dependency array (so flipping it false runs the existing cleanup and tears down the channel):

```typescript
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, me.participant_key, me.name, me.color, me.is_facilitator, token, enabled]);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (params are additive with defaults; `RetroClient` still compiles against the old call sites until Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/lib/hooks/use-retro.ts
git commit -m "feat(retro): gate snapshot poll and presence channel on liveness"
```

---

### Task 4: RetroClient (timer freeze, gated live, endRetro, summary layout)

**Files:**
- Modify: `src/app/(retro)/retro/[token]/RetroClient.tsx`

**Interfaces:**
- Consumes: `useRetroSnapshot(..., live)`, `useRetroChannel(..., enabled)` (Task 3); `RetroSummary` (Task 6); `CommitPanel` `canEnd`/`onEnd` (Task 5); `useQueryClient` for nothing new (rpc handles cache).
- Produces: renders `<RetroSummary>` when `ended`; passes `canEnd`/`onEnd` to `CommitPanel`.

- [ ] **Step 1: Confirm RetroClient is the only consumer of the changed hooks**

Run: `grep -rn "useRetroChannel\|useRetroSnapshot" src/`
Expected: only `src/lib/hooks/use-retro.ts` (definitions) and `src/app/(retro)/retro/[token]/RetroClient.tsx` (calls). No other call sites to update.

- [ ] **Step 2: Add the `ended` flag**

In `RetroClient.tsx`, after `const sealed = phase === "closed";` (line ~69) add:

```typescript
  const ended = !!board.ended_at;
```

- [ ] **Step 3: Add `exported` state**

Next to the other `React.useState` calls (after `const [saveError, ...]`, line ~73) add:

```typescript
  const [exported, setExported] = React.useState(false);
```

- [ ] **Step 4: Gate the snapshot poll and the channel on liveness**

Change the snapshot call (line ~48):

```typescript
  const { data } = useRetroSnapshot(token, me?.key, initialSnapshot, !ended);
```

Change the channel call (line ~96). Pass `undefined` for the unused `onEvent`, then `!ended`:

```typescript
  const { broadcast } = useRetroChannel(token, board.id, presenceMe, setPeople, undefined, !ended);
```

- [ ] **Step 5: Freeze the timer interval**

Replace the `setNow` interval effect (lines ~124-128) so it does not run once sealed or ended. This is the retroactive fix for the runaway timer on every already-closed board:

```typescript
  // Live phase timer (count-up from phase_started_at). Frozen once the retro is
  // sealed or ended: a closed board has no active phase to time, and leaving the
  // interval running is what produced the runaway 2325:37. This also retroactively
  // fixes every already-closed board in the wild (no migration backfill needed).
  React.useEffect(() => {
    if (sealed || ended) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [sealed, ended]);
```

- [ ] **Step 6: Set `exported` inside exportMarkdown**

In `exportMarkdown()` (line ~277), after the download (`URL.revokeObjectURL(url);`) add:

```typescript
    setExported(true);
```

- [ ] **Step 7: Add `endRetro()`**

After `exportMarkdown()` (before `saveToMinutia`), add. NOTE: deliberately NO optimistic `ended_at` patch. An optimistic patch would flip `ended` true and tear down the channel before the broadcast fires, so peers would only catch up on their next 3s poll. Broadcasting from the `event` builder (which fires before the cache is touched, while the channel is still alive) gives peers the instant flip; the sender flips when the rpc's trailing refetch returns `ended_at`.

```typescript
  function endRetro() {
    // Facilitator-only and irreversible. retro_end requires phase='closed' (sealed)
    // and is idempotent server-side. No optimistic patch: we must broadcast on the
    // still-live channel before our own ended state tears it down (see useRetroRpc).
    if (!isFacilitator || !ftoken) return;
    void rpc("retro_end", { p_ftoken: ftoken }, {
      event: (data) => {
        const ts = (data as { ended_at?: string }).ended_at;
        return ts ? { t: "retro.ended", ended_at: ts } : null;
      },
    });
  }
```

- [ ] **Step 8: Pass canEnd/onEnd to CommitPanel**

In the `<CommitPanel ... />` JSX (line ~388), add two props:

```typescript
            saveError={saveError}
            canEnd={sealed && isFacilitator && (!!savedSeriesId || exported)}
            onEnd={endRetro}
```

- [ ] **Step 9: Render the frozen summary layout when ended**

Add the `RetroSummary` import with the other component imports (near line ~26):

```typescript
import { RetroSummary } from "@/components/retro/RetroSummary";
```

Insert an early return after the `if (!me) { ... }` block (after line ~332), before `const showLobby = ...`. This strips the phase bar, share, and presence per the spec:

```typescript
  if (ended) {
    return (
      <div data-retro={theme} style={{ position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--studio-void)" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 80% at 50% -10%, color-mix(in oklab, var(--accent) 7%, transparent), transparent 55%)" }} />
        <header style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 16, padding: "0 var(--space-6)", height: 56, borderBottom: "1px solid var(--studio-line)", background: "var(--studio-raised)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "var(--glow-accent)" }} />
            <span style={{ fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 600, color: "var(--studio-ink)" }}>{board.name || "Minutia Retro"}</span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
            <Icons.Sun size={15} style={{ color: theme === "daylight" ? "var(--accent)" : "var(--studio-ink-3)" }} />
            <Switch checked={theme === "daylight"} onChange={(v) => setTheme(v ? "daylight" : "studio")} size="sm" />
            <Icons.Moon size={14} style={{ color: theme === "studio" ? "var(--studio-ink-2)" : "var(--studio-ink-3)" }} />
          </div>
        </header>
        <main style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0 }}>
          <RetroSummary
            boardName={board.name}
            columns={columns}
            cards={snapshot.cards}
            votes={snapshot.votes}
            actions={snapshot.actions}
            savedSeriesId={savedSeriesId}
            onExport={exportMarkdown}
          />
        </main>
      </div>
    );
  }
```

- [ ] **Step 10: Update the PhaseBar timer (defensive; covers the sealed case)**

Change the `<PhaseBar ... />` `timer` prop (line ~370) so the timer is hidden once sealed or ended:

```typescript
        <PhaseBar phases={RETRO_PHASE_LABEL_LIST} current={phaseIdx} timer={sealed || ended ? null : timer} isFacilitator={isFacilitator} onAdvance={advance} />
```

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY about the not-yet-created `RetroSummary` and the not-yet-added `CommitPanel` props. (Those land in Tasks 5 and 6. If you are executing strictly in order, expect this task's typecheck to fail on those two symbols; it goes green after Task 6.)

- [ ] **Step 12: Commit**

```bash
git add "src/app/(retro)/retro/[token]/RetroClient.tsx"
git commit -m "feat(retro): freeze timer when sealed/ended, end-retro flow, summary layout"
```

---

### Task 5: CommitPanel "End retro" button + ConfirmDialog

**Files:**
- Create: `src/components/retro/ConfirmDialog.tsx`
- Modify: `src/components/retro/CommitPanel.tsx`

**Interfaces:**
- Consumes: `Button` (existing), `Icons` (existing).
- Produces:
  - `ConfirmDialog({ open, title, body, warning?, confirmLabel, onConfirm, onCancel, tone? }: ConfirmDialogProps)` — `tone?: "danger" | "default"`. `position: fixed; inset: 0` overlay (covers full viewport regardless of mount point), backdrop blur, click-outside cancels, `Esc` cancels.
  - `CommitPanelProps` gains `canEnd: boolean` and `onEnd: () => void`. When `canEnd`, an "End retro" button renders below the sealed nudge and opens the ConfirmDialog; confirming calls `onEnd()`.

- [ ] **Step 1: Create ConfirmDialog**

Create `src/components/retro/ConfirmDialog.tsx`:

```typescript
"use client";

import React from "react";
import { Button } from "./Button";
import { Icons } from "./icons";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  warning?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: "danger" | "default";
}

export function ConfirmDialog({ open, title, body, warning, confirmLabel, onConfirm, onCancel, tone = "default" }: ConfirmDialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-8)",
      background: "color-mix(in oklab, var(--studio-void) 74%, transparent)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} style={{ width: "100%", maxWidth: 440, background: "var(--studio-raised)", borderRadius: "var(--r-panel)", border: "1px solid var(--studio-line-2)", boxShadow: "var(--lift-panel)", padding: "var(--space-8)" }}>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "1.5rem", fontWeight: 600, color: "var(--studio-ink)", margin: "0 0 10px", letterSpacing: "-0.01em" }}>{title}</h2>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, lineHeight: 1.5, color: "var(--studio-ink-2)", margin: 0 }}>{body}</p>
        {warning && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14, padding: "10px 12px", borderRadius: "var(--r-control)", background: "var(--accent-soft)", border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)" }}>
            <Icons.Clock size={16} style={{ color: "var(--accent-bright)", flex: "0 0 auto", marginTop: 1 }} />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.45, color: "var(--studio-ink)" }}>{warning}</span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22 }}>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the props + button to CommitPanel**

In `src/components/retro/CommitPanel.tsx`, add to the imports:

```typescript
import { ConfirmDialog } from "./ConfirmDialog";
```

Extend `CommitPanelProps`:

```typescript
  saveError: string | null;
  canEnd: boolean;
  onEnd: () => void;
```

Add local confirm state and destructure the new props in the component signature:

```typescript
export function CommitPanel({ actions, sealed, isFacilitator, onSeal, bloom, onSave, onExport, saving, savedSeriesId, saveError, canEnd, onEnd }: CommitPanelProps) {
  const [confirmEnd, setConfirmEnd] = React.useState(false);
```

Immediately after the sealed nudge `<div>` (the one closing at line ~114, inside the `width:100%;maxWidth:620` wrapper, after the `) : (` sealed branch's closing `</div>`), render the End-retro affordance and dialog. Place it right before the wrapper `</div>` that closes `maxWidth: 620`:

```typescript
        {canEnd && (
          <div style={{ marginTop: 22, textAlign: "center" }}>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--studio-ink-3)", margin: "0 0 12px" }}>
              Everyone done? End the retro to lock the board for everyone.
            </p>
            <Button variant="secondary" onClick={() => setConfirmEnd(true)} iconLeft={<Icons.CheckCircle size={17} />}>
              End retro
            </Button>
          </div>
        )}

        <ConfirmDialog
          open={confirmEnd}
          tone="danger"
          title="End this retro?"
          body="This ends the retro for everyone. The board becomes read-only and live editing stops. This can't be undone."
          warning={savedSeriesId ? undefined : "You exported markdown but didn't save to Minutia, so this board still expires in 30 days."}
          confirmLabel="End retro"
          onConfirm={() => { setConfirmEnd(false); onEnd(); }}
          onCancel={() => setConfirmEnd(false)}
        />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from CommitPanel/ConfirmDialog. (RetroClient still references RetroSummary until Task 6.)

- [ ] **Step 4: Commit**

```bash
git add src/components/retro/ConfirmDialog.tsx src/components/retro/CommitPanel.tsx
git commit -m "feat(retro): End retro button + reusable ConfirmDialog"
```

---

### Task 6: RetroSummary (frozen read-only view)

**Files:**
- Create: `src/components/retro/RetroSummary.tsx`

**Interfaces:**
- Consumes: `RetroColumn`, `RetroCard`, `RetroAction`, `PastelColor` types; `RetroCard` component, `Avatar`, `Badge`, `Button`, `Icons`, `Link`.
- Produces: `RetroSummary({ boardName, columns, cards, votes, actions, savedSeriesId, onExport }: RetroSummaryProps)`.
  - `RetroSummaryProps = { boardName: string; columns: RetroColumn[]; cards: RetroCardData[]; votes: Record<string, number>; actions: RetroAction[]; savedSeriesId: string | null; onExport: () => void; }`.

- [ ] **Step 1: Create RetroSummary**

Create `src/components/retro/RetroSummary.tsx`. Read-only: cards render face-up via the existing `RetroCard` component (no click handlers, no add buttons, no vote control); actions mirror the sealed CommitPanel row styling:

```typescript
"use client";

import React from "react";
import Link from "next/link";
import type { RetroColumn, RetroCard as RetroCardData, RetroAction } from "@/lib/retro/types";
import { RetroCard } from "./RetroCard";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Icons } from "./icons";

export interface RetroSummaryProps {
  boardName: string;
  columns: RetroColumn[];
  cards: RetroCardData[];
  votes: Record<string, number>;
  actions: RetroAction[];
  savedSeriesId: string | null;
  onExport: () => void;
}

export function RetroSummary({ boardName, columns, cards, votes, actions, savedSeriesId, onExport }: RetroSummaryProps) {
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "var(--space-10) var(--space-6)" }}>
      <div style={{ width: "100%", maxWidth: 920, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--success)", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
            <Icons.CheckCircle size={16} /> Retro complete
          </div>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(2rem,4vw,2.75rem)", fontWeight: 600, color: "var(--studio-ink)", margin: 0, letterSpacing: "-0.01em" }}>{boardName || "Minutia Retro"}</h1>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--studio-ink-2)", margin: "8px 0 0" }}>
            This board is read-only. Live editing has ended.
          </p>
        </div>

        {actions.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "1.4rem", fontWeight: 600, color: "var(--studio-ink)", margin: "0 0 16px" }}>Action items</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {actions.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", background: "var(--studio-raised)", borderRadius: "var(--r-panel)", border: "1px solid color-mix(in oklab, var(--accent) 35%, transparent)", boxShadow: "var(--glow-accent)" }}>
                  <span style={{ display: "inline-flex", width: 26, height: 26, borderRadius: "50%", alignItems: "center", justifyContent: "center", background: "var(--accent)", color: "#1a1815", flex: "0 0 auto" }}>
                    <Icons.Check size={14} />
                  </span>
                  <span style={{ flex: 1, fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--studio-ink)", lineHeight: 1.4 }}>{a.text}</span>
                  {a.owner_name && <Avatar name={a.owner_name} color={a.color} size={28} />}
                  {a.due && <Badge tone={a.due === "Fri" ? "warn" : "neutral"}>{a.due}</Badge>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ marginBottom: 40 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))`, gap: "var(--space-5)" }}>
            {columns.map((col) => {
              const items = cards.filter((c) => c.column_id === col.id);
              return (
                <div key={col.id}>
                  <header style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--studio-line)" }}>
                    <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "1.25rem", fontWeight: 600, color: "var(--studio-ink)", margin: 0 }}>{col.title}</h3>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--studio-ink-3)" }}>{items.length}</span>
                  </header>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                    {items.map((card) => (
                      <RetroCard key={card.id} color={card.color} author={card.author_name} votes={votes[card.id] ?? null} faceDown={false} tilt={0}>
                        {card.text}
                      </RetroCard>
                    ))}
                    {items.length === 0 && (
                      <span style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--studio-ink-3)", padding: "8px 2px" }}>Nothing here.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, paddingTop: 8 }}>
          {savedSeriesId && (
            <Link href={`/series/${savedSeriesId}`} style={{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--accent-bright)" }}>
              Open the series &rarr;
            </Link>
          )}
          <Button variant="ghost" onClick={onExport} iconLeft={<Icons.Download size={17} />}>Export markdown</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the consumed primitives exist with these props**

Run: `grep -n "votes\|faceDown\|tilt\|author" src/components/retro/RetroCard.tsx`
Expected: `RetroCard` accepts `color`, `author`, `votes` (number | null), `faceDown`, `tilt`, and `children` (confirmed in Board.tsx usage). If `votes` cannot be null, pass `votes[card.id] ?? 0`. Confirm `Avatar` and `Badge` props match the CommitPanel usage (they do: `Avatar name color size`, `Badge tone`).

- [ ] **Step 3: Typecheck the whole client**

Run: `npx tsc --noEmit`
Expected: PASS (RetroSummary now exists; CommitPanel props added in Task 5; RetroClient wiring from Task 4 resolves).

- [ ] **Step 4: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: lint clean, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/retro/RetroSummary.tsx
git commit -m "feat(retro): frozen read-only RetroSummary for ended boards"
```

---

### Task 7: Contract e2e (direct anon-RPC matrix)

**Files:**
- Create: `e2e/regression/retro-end.spec.ts`

**Interfaces:**
- Consumes: local Supabase REST `/rest/v1/rpc/<fn>` with the anon key; `retro_create`, `retro_set_phase`, `retro_end`, `retro_add_card`, `retro_vote`, `retro_join`, `retro_snapshot`.
- Produces: a contract suite proving the RPC behavior matrix.

- [ ] **Step 1: Write the contract spec**

Create `e2e/regression/retro-end.spec.ts`. Calls RPCs directly as a client would (anon key), so it tests the SQL contract without UI timing. Uses the local Supabase default anon key from env; skips if absent. `retro_create` returns `{token, facilitator_token, board_id, participant_key}`.

```typescript
/**
 * retro-end.spec.ts
 *
 * Contract matrix for the terminal "ended" state, exercised by calling the
 * SECURITY DEFINER RPCs directly (as the anon client does). No UI: this nails
 * the SQL behavior (facilitator-only, must-seal-first, idempotent, mutation
 * rejection, snapshot still resolves) independent of realtime timing.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function anonHeaders() {
  return { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" };
}

async function rpc(request: APIRequestContext, fn: string, body: Record<string, unknown>) {
  return request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { headers: anonHeaders(), data: body });
}

// Create a board, seal it, return its tokens.
async function createSealed(request: APIRequestContext) {
  const created = await rpc(request, "retro_create", {
    p_name: `End Test ${Date.now()}`,
    p_template: "ssc",
    p_columns: [{ id: "start", title: "Start" }, { id: "stop", title: "Stop" }, { id: "continue", title: "Continue" }],
    p_facilitator_name: "Fac",
    p_facilitator_color: "sky",
    p_participant_key: `pk-${Date.now()}`,
  });
  expect(created.ok()).toBeTruthy();
  const b = await created.json();
  const sealed = await rpc(request, "retro_set_phase", { p_ftoken: b.facilitator_token, p_phase: "closed" });
  expect(sealed.ok()).toBeTruthy();
  return b as { token: string; facilitator_token: string; board_id: string; participant_key: string };
}

test.describe("retro_end contract", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(!ANON_KEY, "Requires SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)");

  test("rejects a bad facilitator token", async ({ request }) => {
    const res = await rpc(request, "retro_end", { p_ftoken: "not-a-real-token" });
    expect(res.ok()).toBeFalsy();
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("bad facilitator token");
  });

  test("rejects when the board is not sealed", async ({ request }) => {
    const created = await rpc(request, "retro_create", {
      p_name: `Unsealed ${Date.now()}`, p_template: "ssc",
      p_columns: [{ id: "start", title: "Start" }],
      p_facilitator_name: "Fac", p_facilitator_color: "sky", p_participant_key: `pk-${Date.now()}`,
    });
    const b = await created.json();
    const res = await rpc(request, "retro_end", { p_ftoken: b.facilitator_token });
    expect(res.ok()).toBeFalsy();
    expect(JSON.stringify(await res.json())).toContain("not sealed");
  });

  test("is idempotent: second end reports already_ended, same ended_at", async ({ request }) => {
    const b = await createSealed(request);
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

  test("after ending, live mutations are rejected", async ({ request }) => {
    const b = await createSealed(request);
    await rpc(request, "retro_end", { p_ftoken: b.facilitator_token });

    const add = await rpc(request, "retro_add_card", { p_token: b.token, p_key: b.participant_key, p_column: "start", p_text: "nope", p_color: "sky" });
    expect(add.ok()).toBeFalsy();
    expect(JSON.stringify(await add.json())).toContain("board ended");

    const vote = await rpc(request, "retro_vote", { p_token: b.token, p_key: b.participant_key, p_card: "00000000-0000-0000-0000-000000000000", p_delta: 1 });
    expect(vote.ok()).toBeFalsy();
    expect(JSON.stringify(await vote.json())).toContain("board ended");

    const join = await rpc(request, "retro_join", { p_token: b.token, p_key: `late-${Date.now()}`, p_name: "Late", p_color: "rose" });
    expect(join.ok()).toBeFalsy();
    expect(JSON.stringify(await join.json())).toContain("board ended");

    const phase = await rpc(request, "retro_set_phase", { p_ftoken: b.facilitator_token, p_phase: "commit" });
    expect(phase.ok()).toBeFalsy();
    expect(JSON.stringify(await phase.json())).toContain("board ended");
  });

  test("snapshot still returns an ended board, with ended_at populated", async ({ request }) => {
    const b = await createSealed(request);
    await rpc(request, "retro_end", { p_ftoken: b.facilitator_token });
    const snap = await rpc(request, "retro_snapshot", { p_token: b.token, p_key: b.participant_key });
    expect(snap.ok()).toBeTruthy();
    const data = await snap.json();
    expect(data.board.ended_at).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the contract spec**

Run: `pnpm test:e2e retro-end`
Expected: PASS (or all-skipped if `SUPABASE_ANON_KEY` is unset locally; in that case confirm the key and re-run). Verify the matrix is green, not silently skipped, before declaring done.

- [ ] **Step 3: Commit**

```bash
git add e2e/regression/retro-end.spec.ts
git commit -m "test(retro): direct-RPC contract matrix for ending a retro"
```

---

### Task 8: UI e2e (summary, frozen timer, peer flip, late joiner)

**Files:**
- Modify: `e2e/regression/retro-ritual.spec.ts`

**Interfaces:**
- Consumes: existing helpers `withRetroEnabled`, `createBoardAndNavigate`, `enterLobby` in the spec.

- [ ] **Step 1: Add the end-to-summary + peer-flip + late-joiner tests**

Append inside the `test.describe("Retro ritual, facilitator flow", ...)` block in `e2e/regression/retro-ritual.spec.ts`, after the last test (before the describe's closing `});`). A small local helper drives Lobby -> Commit -> Seal to cut repetition:

```typescript
  // Drive a freshly created+joined board through to a sealed Commit panel.
  async function sealCurrentBoard(page: import("@playwright/test").Page) {
    const advance = () => page.getByRole("button", { name: "Advance" }).first().click();
    await expect(page.getByText("Reflect").first()).toBeVisible({ timeout: 10_000 });
    await advance();
    await expect(page.getByText("Reveal & Vote").first()).toBeVisible({ timeout: 10_000 });
    await advance();
    await expect(page.getByText("Discuss").first()).toBeVisible({ timeout: 10_000 });
    await advance();
    await expect(page.getByRole("heading", { name: "Commit the actions" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Seal these decisions" }).first().click();
    await expect(page.getByRole("heading", { name: "Sealed, nice work." })).toBeVisible({ timeout: 10_000 });
  }

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
        await guest.goto(boardUrl);
        await guest.waitForLoadState("domcontentloaded");
        await enterLobby(guest, "Riley");

        await sealCurrentBoard(page);
        await page.getByRole("button", { name: "Just export markdown" }).first().click();
        await page.getByRole("button", { name: "End retro" }).first().click();
        await page.getByRole("dialog").getByRole("button", { name: "End retro" }).click();

        await expect(page.getByText("Retro complete").first()).toBeVisible({ timeout: 10_000 });
        // The peer flips to the summary (broadcast, with the 3s poll as backstop).
        await expect(guest.getByText("Retro complete").first()).toBeVisible({ timeout: 12_000 });
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
      const lateCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const late = await lateCtx.newPage();
      try {
        await late.goto(boardUrl);
        await late.waitForLoadState("domcontentloaded");
        await expect(late.getByText("Retro complete").first()).toBeVisible({ timeout: 10_000 });
        await expect(late.getByPlaceholder("Your name")).toHaveCount(0);
      } finally {
        await lateCtx.close();
      }
    });
  });
```

- [ ] **Step 2: Run the new UI tests**

Run: `pnpm test:e2e retro-ritual`
Expected: PASS (existing ritual tests + the three new ones), skipping only if `SUPABASE_SERVICE_ROLE_KEY` is unset.

- [ ] **Step 3: Commit**

```bash
git add e2e/regression/retro-ritual.spec.ts
git commit -m "test(retro): e2e for ending a retro (summary, peer flip, late joiner)"
```

---

### Task 9: Full gates + two-pass review

**Files:** none (verification only).

- [ ] **Step 1: Apply migration fresh and run the contract verifier**

Run: `npx supabase db reset && pnpm test:retro`
Expected: migration chain applies cleanly; verifier green.

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit && pnpm lint && pnpm build`
Expected: all clean.

- [ ] **Step 3: Full e2e suite**

Run: `pnpm test:e2e`
Expected: green per shard. Compare any failures against the known-flaky baseline (JST timezone + email/share/service-role env per the project memory). New retro specs must pass.

- [ ] **Step 4: OSS boundary scan**

Run: `pnpm test:oss-boundaries`
Expected: no private-repo symbols leaked.

- [ ] **Step 5: Review pass 1 (fresh-context subagent over the full diff vs the spec)**

Dispatch a code reviewer against `git diff feat/retro-instant-realtime...HEAD`, anchored on the spec's requirements and the repo CLAUDE.md constraints (no em-dashes, least-code, RPC guard coverage, snapshot-still-returns, facilitator-only, idempotent, timer freeze, no presence/poll when ended). Fix every finding; re-run the affected gate.

- [ ] **Step 6: Review pass 2 (independent fresh-context pass)**

Second independent reviewer over the final diff. Fix findings; re-run gates. Record a clean pass.

- [ ] **Step 7: Final commit (if fixes were made)**

```bash
git add -A && git commit -m "fix(retro): address end-session review findings"
```

---

## Self-Review (against the spec)

**Spec coverage:**
- SQL: `ended_at` column, `_retro_assert_live` (revoked), `retro_end` (facilitator-only, must-seal, idempotent, granted), snapshot carries `ended_at` and does not assert live, all 9 mutation RPCs + `retro_join` guarded -> Task 1. ✓
- Types: `board.ended_at`, `retro.ended` broadcast -> Task 2. ✓
- Hooks: `useRetroSnapshot(live)`, `useRetroChannel(enabled)`, `applyRetroEvent(retro.ended)` -> Tasks 2, 3. ✓
- RetroClient: `ended`, `timer={sealed||ended?null:timer}`, `setNow` stop, gated live, `exported`, `endRetro`, summary render -> Task 4. ✓
- CommitPanel + ConfirmDialog: `canEnd`/`onEnd`, End button, styled confirm with export-only 30-day warning -> Task 5. ✓
- RetroSummary: header, read-only columns/cards, sealed actions, Open the series / Export -> Task 6. ✓
- page.tsx: no change required (SSR snapshot carries `ended_at`; client renders summary) -> confirmed, no task. ✓
- Tests: contract (RPC matrix) -> Task 7; unit (applyRetroEvent) + SQL-text guards -> Tasks 1, 2; e2e (summary, peer flip, save/export paths, late joiner) -> Task 8. ✓
- Edge cases: end-before-seal (RPC reject + button hidden), double-end (idempotent), non-facilitator (42501 + button hidden), export-only warning, peer ordering (broadcast before teardown), already-closed retroactive timer fix, saved-then-ended -> covered across Tasks 1, 4, 5, 7, 8. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. ✓

**Type consistency:** `endRetro`, `ended`, `exported`, `canEnd`, `onEnd`, `RetroSummaryProps`, `ConfirmDialogProps` names match across Tasks 4-6; `retro.ended` payload `{ ended_at: string }` consistent in types, reducer, broadcast, and `endRetro`. ✓
