# Minutia Retro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free, anonymous, multiplayer retrospective board at `/retro` (the disguised Minutia acquisition funnel) with a guided 7-phase ritual, realtime presence + synchronized Reveal, AI theme suggestions, and account-gated graduation of action items into Minutia issues.

**Architecture:** Anonymous writes go through `SECURITY DEFINER` Postgres RPCs (token + participant-key validated, rate-limited, capped); `retro_*` tables are default-deny to `anon`. Liveness uses Supabase Realtime Broadcast + Presence keyed on the unguessable board UUID, with a ~3s snapshot reconcile. Facilitator-only actions require a second secret facilitator token. The "Studio After Dark" design system is ported from the prototype in `~/Downloads/Minutia Retro Design System/` to typed Next.js client components with tokens scoped under `[data-retro]`.

**Tech Stack:** Next.js 16 App Router (React 19.2, `use client`), Tailwind CSS v4 + CSS vars, Supabase (Postgres RPC/RLS, Realtime broadcast/presence), TanStack Query, Motion, OpenRouter (existing `src/lib/ai/openrouter.ts`), Playwright + node:test.

**Source-of-truth references (read before porting UI):**
- Prototype kit: `/Volumes/Mango/Downloads/Minutia Retro Design System/` — `tokens/*.css`, `components/{core,forms,retro}/*.jsx`, `ui_kits/retro-board/*.jsx`.
- Design spec: `docs/superpowers/specs/2026-06-16-minutia-retro-design.md`.
- Product concept: `docs/research/retro-board.md`.

**Conventions (verified):**
- Supabase clients: `src/lib/supabase/{client,server,service-role}.ts`.
- Existing capability-token + `SECURITY DEFINER` RPC pattern: `supabase/migrations/00010_guest_share_token_lookup.sql`, `src/app/share/[token]/page.tsx`.
- Realtime/presence hook pattern: `src/lib/hooks/use-meetings.ts` (`useMeetingRealtime`, `useMeetingPresence`).
- AI transport: `callOpenRouter`, `getOpenRouterApiKey` in `src/lib/ai/openrouter.ts`; route pattern `src/app/api/series/[seriesId]/ask/route.ts`.
- Issues/series hooks: `src/lib/hooks/use-issues.ts`, `use-series.ts`; types in `src/lib/types.ts`.
- Middleware setup/auth gate: `middleware.ts` (`publicPaths`, `setupExemptPaths`).
- instance_config read: `src/lib/instance-config.ts` (service-role key/value).
- Verifiers run with `node --test scripts/verify-*.test.mjs`; E2E with `pnpm test:e2e`.

---

## File Structure

**Create**
- `supabase/migrations/20260616090000_retro_boards.sql` — tables, RLS (default-deny), indexes, `issues.source += 'retro'`, `instance_config` seed.
- `supabase/migrations/20260616091000_retro_rpcs.sql` — all `SECURITY DEFINER` RPCs + `anon`/`authenticated` EXECUTE grants.
- `supabase/migrations/20260616092000_retro_cleanup.sql` — expiry cleanup function + optional pg_cron schedule (guarded).
- `src/lib/retro/types.ts` — TS types for board/card/vote/action/participant/snapshot/broadcast events.
- `src/lib/retro/templates.ts` — the 4 templates (columns) + helpers (pure).
- `src/lib/retro/vote-budget.ts` — pure dot-vote budget logic.
- `src/lib/retro/parse-due.ts` — pure best-effort due-date parser ("Fri"/"Next sprint" → date|null).
- `src/lib/retro/markdown.ts` — pure board→markdown export.
- `src/lib/retro/local-identity.ts` — participant_key + facilitator_token localStorage helpers (client).
- `src/lib/hooks/use-retro.ts` — snapshot query, RPC mutations, broadcast+presence, reconcile.
- `src/components/retro/` — ported components (see Tasks 6–8).
- `src/app/(retro)/layout.tsx` — public layout, sets `[data-retro]`, loads scoped tokens.
- `src/app/(retro)/retro/page.tsx` — create / template picker.
- `src/app/(retro)/retro/[token]/page.tsx` — live board (server: enabled-flag check + initial snapshot).
- `src/app/(retro)/retro/[token]/RetroClient.tsx` — `use client` orchestration.
- `src/app/(retro)/retro/disabled/page.tsx` — "not enabled on this instance".
- `src/app/api/retro/[token]/suggest-themes/route.ts` — AI clustering suggestions.
- `src/app/api/retro/[token]/graduate/route.ts` — account-gated graduation.
- `src/styles/retro.css` — scoped `[data-retro]` token block (imported by retro layout).
- `scripts/verify-retro-contracts.test.mjs` — pure-logic + RPC-shape verifier.
- `e2e/regression/retro-create.spec.ts`, `retro-ritual.spec.ts`, `retro-multiplayer.spec.ts`, `retro-graduate.spec.ts`, `retro-disabled.spec.ts`.

**Modify**
- `middleware.ts` — add `/retro`, `/api/retro` to `publicPaths` + `setupExemptPaths`.
- `src/app/globals.css` — `@import "../styles/retro.css";` (scoped, no global leakage).
- `src/lib/instance-config.ts` — add `retro_enabled` to non-secret known keys if an allow-list exists (check first).
- Admin runtime-settings UI (locate under `src/app/(app)/settings/`) — add `retro_enabled` toggle.
- `package.json` — add `"test:retro": "node --test scripts/verify-retro-contracts.test.mjs"`.
- `CHANGELOG.md` — entry.

---

## Task 1: Database schema + RLS (default-deny)

**Files:**
- Create: `supabase/migrations/20260616090000_retro_boards.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Minutia Retro: anonymous ephemeral retro boards.
-- Tables are DEFAULT-DENY to anon/authenticated; all access is via SECURITY DEFINER
-- RPCs in 20260616091000_retro_rpcs.sql. Liveness is Realtime broadcast/presence (no table reads).

create table public.retro_boards (
  id                 uuid primary key default gen_random_uuid(),
  token              text not null unique default encode(gen_random_bytes(18), 'hex'),
  facilitator_token  text not null unique default encode(gen_random_bytes(18), 'hex'),
  name               text not null,
  template           text not null check (template in ('msg','ssc','4ls','fire')),
  columns            jsonb not null,
  phase              text not null default 'lobby'
                       check (phase in ('lobby','reflect','reveal','theme','vote','discuss','commit','closed')),
  phase_started_at   timestamptz,
  settings           jsonb not null default '{}'::jsonb,
  previous_board_id  uuid references public.retro_boards(id) on delete set null,
  saved_to_series_id uuid references public.meeting_series(id) on delete set null,
  claimed_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  expires_at         timestamptz not null default now() + interval '30 days'
);

create table public.retro_participants (
  id              uuid primary key default gen_random_uuid(),
  board_id        uuid not null references public.retro_boards(id) on delete cascade,
  participant_key text not null,
  name            text not null,
  color           text not null,
  is_facilitator  boolean not null default false,
  user_id         uuid references public.profiles(id) on delete set null,
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (board_id, participant_key)
);

create table public.retro_cards (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.retro_boards(id) on delete cascade,
  column_id   text not null,
  author_key  text not null,
  author_name text not null default '',
  color       text not null default 'sand',
  text        text not null check (char_length(text) <= 280),
  group_id    uuid,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.retro_votes (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.retro_boards(id) on delete cascade,
  card_id    uuid not null references public.retro_cards(id) on delete cascade,
  voter_key  text not null,
  created_at timestamptz not null default now(),
  unique (board_id, card_id, voter_key)
);

create table public.retro_actions (
  id                 uuid primary key default gen_random_uuid(),
  board_id           uuid not null references public.retro_boards(id) on delete cascade,
  text               text not null check (char_length(text) <= 280),
  owner_name         text not null default '',
  due                text not null default '',
  color              text not null default 'sand',
  source_card_id     uuid references public.retro_cards(id) on delete set null,
  graduated_issue_id uuid references public.issues(id) on delete set null,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now()
);

create index retro_boards_expires_idx on public.retro_boards (expires_at) where saved_to_series_id is null;
create index retro_participants_board_idx on public.retro_participants (board_id);
create index retro_cards_board_idx on public.retro_cards (board_id);
create index retro_votes_board_idx on public.retro_votes (board_id);
create index retro_actions_board_idx on public.retro_actions (board_id);

-- DEFAULT-DENY: enable RLS, add NO permissive policies. Only SECURITY DEFINER RPCs touch these.
alter table public.retro_boards       enable row level security;
alter table public.retro_participants enable row level security;
alter table public.retro_cards        enable row level security;
alter table public.retro_votes        enable row level security;
alter table public.retro_actions      enable row level security;

revoke all on public.retro_boards, public.retro_participants, public.retro_cards,
  public.retro_votes, public.retro_actions from anon, authenticated;

-- issues.source gains 'retro'
alter table public.issues drop constraint if exists issues_source_check;
alter table public.issues add constraint issues_source_check
  check (source in ('manual','transcript','email','api','ai_suggested','retro'));

-- availability flag (default off; cloud turns on). instance_config is key/value.
insert into public.instance_config (key, value)
  values ('retro_enabled', 'false')
  on conflict (key) do nothing;
```

- [ ] **Step 2: Apply locally and verify it loads**

Run: `pnpm supabase migration up` (or the repo's migration runner; check `scripts/run-self-host-migrations.sh`).
Expected: migration applies with no error; `\d public.retro_boards` shows the table; `select value from instance_config where key='retro_enabled'` returns `false`.

- [ ] **Step 3: Verify default-deny**

Run (psql as anon role or via REST): `select * from public.retro_boards;`
Expected: zero rows / permission denied — anon cannot read the table directly.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260616090000_retro_boards.sql
git commit -m "feat(retro): retro board schema with default-deny RLS"
```

---

## Task 2: SECURITY DEFINER RPCs

**Files:**
- Create: `supabase/migrations/20260616091000_retro_rpcs.sql`

Validation rules common to all guest RPCs: board exists, `expires_at > now()` (unless saved), and `participant_key` is a member of the board. Facilitator RPCs require `facilitator_token` match. All functions are `security definer set search_path = public`.

- [ ] **Step 1: Write the RPC migration**

```sql
-- All functions: SECURITY DEFINER, search_path pinned. Anon calls these; never the tables.

-- Internal helper: resolve a live board by token (raises on missing/expired).
create or replace function public._retro_live_board(p_token text)
returns public.retro_boards language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  select * into b from public.retro_boards where token = p_token;
  if b.id is null then raise exception 'retro: board not found' using errcode = 'P0002'; end if;
  if b.saved_to_series_id is null and b.expires_at <= now() then
    raise exception 'retro: board expired' using errcode = 'P0001';
  end if;
  return b;
end $$;

create or replace function public._retro_assert_member(p_board uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.retro_participants where board_id = p_board and participant_key = p_key) then
    raise exception 'retro: not a participant' using errcode = '42501';
  end if;
end $$;

create or replace function public._retro_assert_facilitator(p_token text)
returns public.retro_boards language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  select * into b from public.retro_boards where facilitator_token = p_token;
  if b.id is null then raise exception 'retro: bad facilitator token' using errcode = '42501'; end if;
  return b;
end $$;

-- CREATE: returns secrets to the creator only.
create or replace function public.retro_create(
  p_name text, p_template text, p_columns jsonb,
  p_facilitator_name text, p_facilitator_color text, p_participant_key text,
  p_previous_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; prev uuid;
begin
  if char_length(coalesce(p_name,'')) = 0 or char_length(p_name) > 120 then
    raise exception 'retro: invalid name' using errcode = '22000';
  end if;
  -- global abuse cap: max boards created in the last minute
  if (select count(*) from public.retro_boards where created_at > now() - interval '1 minute') > 60 then
    raise exception 'retro: rate limited' using errcode = '53400';
  end if;
  if p_previous_token is not null then select id into prev from public.retro_boards where token = p_previous_token; end if;
  insert into public.retro_boards (name, template, columns, previous_board_id)
    values (p_name, p_template, p_columns, prev) returning * into b;
  insert into public.retro_participants (board_id, participant_key, name, color, is_facilitator)
    values (b.id, p_participant_key, p_facilitator_name, p_facilitator_color, true);
  return jsonb_build_object('board_id', b.id, 'token', b.token,
    'facilitator_token', b.facilitator_token, 'participant_key', p_participant_key);
end $$;

-- SNAPSHOT: full board state. Carryover = open actions from previous board chain.
create or replace function public.retro_snapshot(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token);
  return jsonb_build_object(
    'board', jsonb_build_object('id', b.id, 'name', b.name, 'template', b.template,
      'columns', b.columns, 'phase', b.phase, 'phase_started_at', b.phase_started_at,
      'settings', b.settings, 'saved_to_series_id', b.saved_to_series_id, 'expires_at', b.expires_at),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('participant_key', participant_key,
      'name', name, 'color', color, 'is_facilitator', is_facilitator) order by created_at)
      from public.retro_participants where board_id = b.id), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'column_id', column_id,
      'author_key', author_key, 'author_name', author_name, 'color', color, 'text', text,
      'group_id', group_id, 'sort_order', sort_order) order by sort_order, created_at)
      from public.retro_cards where board_id = b.id), '[]'::jsonb),
    'votes', coalesce((select jsonb_object_agg(card_id, n) from (
      select card_id, count(*) n from public.retro_votes where board_id = b.id group by card_id) t), '{}'::jsonb),
    'my_votes', '[]'::jsonb,
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'text', text, 'owner_name', owner_name,
      'due', due, 'color', color, 'graduated_issue_id', graduated_issue_id) order by sort_order, created_at)
      from public.retro_actions where board_id = b.id), '[]'::jsonb),
    'carryover', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text, 'done', false))
      from public.retro_actions a where a.board_id = b.previous_board_id), '[]'::jsonb)
  );
end $$;

-- JOIN
create or replace function public.retro_join(p_token text, p_key text, p_name text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token);
  if (select count(*) from public.retro_participants where board_id = b.id) >= 25
     and not exists (select 1 from public.retro_participants where board_id = b.id and participant_key = p_key) then
    raise exception 'retro: board full' using errcode = '53400';
  end if;
  insert into public.retro_participants (board_id, participant_key, name, color)
    values (b.id, p_key, left(p_name, 40), p_color)
    on conflict (board_id, participant_key) do update set name = excluded.name, color = excluded.color, last_seen_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ADD CARD (caps: 200/board, 12/participant/min)
create or replace function public.retro_add_card(p_token text, p_key text, p_column text, p_text text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; c public.retro_cards; nm text;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_member(b.id, p_key);
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

-- UPDATE / DELETE own card (or facilitator via separate path not needed for v1)
create or replace function public.retro_update_card(p_token text, p_key text, p_card uuid, p_text text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_member(b.id, p_key);
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
  b := public._retro_live_board(p_token); perform public._retro_assert_member(b.id, p_key);
  delete from public.retro_cards where id = p_card and board_id = b.id and author_key = p_key;
  if not found then raise exception 'retro: not your card' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- VOTE (delta +1/-1, per-voter budget enforced in app + here: max 6 dots/board)
create or replace function public.retro_vote(p_token text, p_key text, p_card uuid, p_delta int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_member(b.id, p_key);
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

-- THEME clustering (facilitator)
create or replace function public.retro_set_card_group(p_ftoken text, p_card_ids uuid[], p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  update public.retro_cards set group_id = p_group, updated_at = now()
    where board_id = b.id and id = any(p_card_ids);
  return jsonb_build_object('ok', true);
end $$;

-- PHASE (facilitator)
create or replace function public.retro_set_phase(p_ftoken text, p_phase text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  if p_phase not in ('lobby','reflect','reveal','theme','vote','discuss','commit','closed') then
    raise exception 'retro: bad phase' using errcode = '22000'; end if;
  update public.retro_boards set phase = p_phase, phase_started_at = now(), updated_at = now() where id = b.id;
  return jsonb_build_object('ok', true, 'phase', p_phase);
end $$;

-- ACTIONS (facilitator)
create or replace function public.retro_add_action(p_ftoken text, p_text text, p_owner text, p_due text, p_color text, p_source uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; a public.retro_actions;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  insert into public.retro_actions (board_id, text, owner_name, due, color, source_card_id)
    values (b.id, left(p_text,280), left(coalesce(p_owner,''),80), left(coalesce(p_due,''),40), coalesce(p_color,'sand'), p_source)
    returning * into a;
  return to_jsonb(a);
end $$;

create or replace function public.retro_update_action(p_ftoken text, p_action uuid, p_text text, p_owner text, p_due text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  update public.retro_actions set text = left(p_text,280), owner_name = left(coalesce(p_owner,''),80), due = left(coalesce(p_due,''),40)
    where id = p_action and board_id = b.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_delete_action(p_ftoken text, p_action uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  delete from public.retro_actions where id = p_action and board_id = b.id;
  return jsonb_build_object('ok', true);
end $$;

-- grants: only EXECUTE on the public RPCs (helpers stay internal).
grant execute on function
  public.retro_create(text,text,jsonb,text,text,text,text),
  public.retro_snapshot(text),
  public.retro_join(text,text,text,text),
  public.retro_add_card(text,text,text,text,text),
  public.retro_update_card(text,text,uuid,text,text),
  public.retro_delete_card(text,text,uuid),
  public.retro_vote(text,text,uuid,int),
  public.retro_set_card_group(text,uuid[],uuid),
  public.retro_set_phase(text,text),
  public.retro_add_action(text,text,text,text,text,uuid),
  public.retro_update_action(text,uuid,text,text,text),
  public.retro_delete_action(text,uuid)
  to anon, authenticated;
```

- [ ] **Step 2: Apply and smoke-test the happy path via RPC**

Run (psql as anon via PostgREST or supabase): call `retro_create('Sprint 24','ssc', '[{"id":"start","title":"Start"},{"id":"stop","title":"Stop"},{"id":"continue","title":"Continue"}]','Priya','sky','pk-1')`.
Expected: returns `{board_id, token, facilitator_token, participant_key}`. Then `retro_snapshot(<token>)` returns board JSON with one participant.

- [ ] **Step 3: Smoke-test guards**

Run: `retro_add_card(<token>,'unknown-key','start','x','sky')`.
Expected: error `retro: not a participant` (42501). `retro_set_phase('wrong-token','reflect')` → `bad facilitator token`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260616091000_retro_rpcs.sql
git commit -m "feat(retro): SECURITY DEFINER RPCs for anonymous board ops"
```

---

## Task 3: Expiry cleanup

**Files:**
- Create: `supabase/migrations/20260616092000_retro_cleanup.sql`

- [ ] **Step 1: Write cleanup function + guarded pg_cron**

```sql
create or replace function public.retro_cleanup_expired()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with del as (
    delete from public.retro_boards
      where saved_to_series_id is null and expires_at <= now() returning 1)
  select count(*) into n from del;
  return n;
end $$;
revoke all on function public.retro_cleanup_expired() from anon, authenticated;

-- Schedule daily if pg_cron is available; ignore if not (self-host without the extension).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('retro-cleanup', '17 3 * * *', 'select public.retro_cleanup_expired();');
  end if;
exception when others then null;
end $$;
```

- [ ] **Step 2: Apply and run once**

Run: `select public.retro_cleanup_expired();`
Expected: returns an integer (0 on a fresh DB).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260616092000_retro_cleanup.sql
git commit -m "feat(retro): expiry cleanup with guarded pg_cron"
```

---

## Task 4: Pure logic + types + contract verifier (TDD)

**Files:**
- Create: `src/lib/retro/types.ts`, `templates.ts`, `vote-budget.ts`, `parse-due.ts`, `markdown.ts`
- Create: `scripts/verify-retro-contracts.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing verifier**

Match the repo verifier pattern exactly (see `scripts/verify-carryover.test.mjs`): bundle each pure TS module with esbuild into a temp `.mjs`, then import it. Do NOT import `.ts`/`.js` source paths directly.

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

async function load(rel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-retro-"));
  const out = path.join(dir, "m.mjs");
  await esbuild.build({ entryPoints: [rel], outfile: out, bundle: true, format: "esm", platform: "node" });
  return import(pathToFileURL(out).href);
}
const { remainingVotes } = await load("src/lib/retro/vote-budget.ts");
const { parseDue } = await load("src/lib/retro/parse-due.ts");
const { boardToMarkdown } = await load("src/lib/retro/markdown.ts");
const { TEMPLATES } = await load("src/lib/retro/templates.ts");

test("vote budget caps at 6 and never negative", () => {
  assert.equal(remainingVotes(0), 6);
  assert.equal(remainingVotes(6), 0);
  assert.equal(remainingVotes(9), 0);
});

test("parseDue resolves relative words to a date or null", () => {
  assert.equal(parseDue(""), null);
  assert.ok(parseDue("2026-07-01") instanceof Date);
  assert.equal(parseDue("next sprint"), null); // free-text stays free-text
});

test("templates expose 4 named boards with columns", () => {
  assert.equal(TEMPLATES.length, 4);
  assert.ok(TEMPLATES.every((t) => Array.isArray(t.columns) && t.columns.length >= 3));
});

test("boardToMarkdown renders columns, actions, escapes pipes", () => {
  const md = boardToMarkdown({
    name: "Sprint 24",
    columns: [{ id: "start", title: "Start" }],
    cards: [{ column_id: "start", text: "Pair on auth", author_name: "Ada" }],
    actions: [{ text: "Add smoke test", owner_name: "Mara", due: "Fri" }],
  });
  assert.match(md, /# Sprint 24/);
  assert.match(md, /## Start/);
  assert.match(md, /Pair on auth/);
  assert.match(md, /Add smoke test/);
});
```

Note: tests import `.js` paths; since the repo runs `.mjs` verifiers against TS, mirror the existing verifier convention (check `verify-carryover.test.mjs` for how it imports TS — replicate exactly, e.g. via compiled output or tsx). If existing verifiers import from `src/**/*.ts` through a loader, match that import style instead of `.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/verify-retro-contracts.test.mjs`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the pure modules**

`src/lib/retro/types.ts`:
```ts
export type RetroPhase = "lobby"|"reflect"|"reveal"|"theme"|"vote"|"discuss"|"commit"|"closed";
export type PastelColor = "amber"|"rose"|"sage"|"sky"|"lilac"|"sand";
export interface RetroColumn { id: string; title: string }
export interface RetroCard { id: string; column_id: string; author_key: string; author_name: string; color: PastelColor; text: string; group_id: string|null; sort_order: number }
export interface RetroParticipant { participant_key: string; name: string; color: PastelColor; is_facilitator: boolean }
export interface RetroAction { id: string; text: string; owner_name: string; due: string; color: PastelColor; graduated_issue_id: string|null }
export interface RetroCarry { id: string; text: string; done: boolean }
export interface RetroSnapshot {
  board: { id: string; name: string; template: string; columns: RetroColumn[]; phase: RetroPhase; phase_started_at: string|null; settings: Record<string, unknown>; saved_to_series_id: string|null; expires_at: string };
  participants: RetroParticipant[]; cards: RetroCard[]; votes: Record<string, number>; my_votes: string[]; actions: RetroAction[]; carryover: RetroCarry[];
}
export type RetroBroadcast =
  | { t: "card.added"|"card.updated"|"card.deleted"; key: string }
  | { t: "vote.changed"; card_id: string }
  | { t: "phase.changed"; phase: RetroPhase }
  | { t: "action.changed" }
  | { t: "carry.toggled"; id: string };
```

`src/lib/retro/vote-budget.ts`:
```ts
export const VOTE_BUDGET = 6;
export const remainingVotes = (used: number) => Math.max(0, VOTE_BUDGET - Math.max(0, used));
```

`src/lib/retro/parse-due.ts`:
```ts
// Best-effort: only resolves explicit ISO/date-like strings to a Date; free-text stays null.
export function parseDue(input: string): Date | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s + "T00:00:00"); return isNaN(+d) ? null : d; }
  return null;
}
```

`src/lib/retro/templates.ts`:
```ts
import type { RetroColumn } from "./types";
export interface RetroTemplate { id: "msg"|"ssc"|"4ls"|"fire"; name: string; desc: string; columns: RetroColumn[]; minutia?: boolean }
const cols = (...t: string[]): RetroColumn[] => t.map((title) => ({ id: title.toLowerCase().replace(/[^a-z]+/g, "-"), title }));
export const TEMPLATES: RetroTemplate[] = [
  { id: "msg", name: "Mad · Sad · Glad", desc: "Surface feelings first", columns: cols("Mad","Sad","Glad") },
  { id: "ssc", name: "Start · Stop · Continue", desc: "Concrete behaviour changes", columns: cols("Start","Stop","Continue") },
  { id: "4ls", name: "4Ls", desc: "Liked · Learned · Lacked · Longed for", columns: cols("Liked","Learned","Lacked","Longed for") },
  { id: "fire", name: "What's still on fire", desc: "Seeded from your open items", columns: cols("Still open","New heat","Cooled off"), minutia: true },
];
```

`src/lib/retro/markdown.ts`:
```ts
import type { RetroColumn, RetroCard, RetroAction } from "./types";
interface MdInput { name: string; columns: RetroColumn[]; cards: Pick<RetroCard,"column_id"|"text"|"author_name">[]; actions: Pick<RetroAction,"text"|"owner_name"|"due">[] }
const esc = (s: string) => s.replace(/\|/g, "\\|");
export function boardToMarkdown({ name, columns, cards, actions }: MdInput): string {
  const lines = [`# ${name}`, ""];
  for (const col of columns) {
    lines.push(`## ${col.title}`);
    for (const c of cards.filter((x) => x.column_id === col.id)) lines.push(`- ${esc(c.text)}${c.author_name ? ` — ${esc(c.author_name)}` : ""}`);
    lines.push("");
  }
  if (actions.length) {
    lines.push("## Action items", "");
    for (const a of actions) lines.push(`- [ ] ${esc(a.text)}${a.owner_name ? ` (@${esc(a.owner_name)})` : ""}${a.due ? ` — due ${esc(a.due)}` : ""}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run to verify it passes; add script**

Add to `package.json` scripts: `"test:retro": "node --test scripts/verify-retro-contracts.test.mjs"`.
Run: `pnpm test:retro`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/retro scripts/verify-retro-contracts.test.mjs package.json
git commit -m "feat(retro): pure logic, types, contract verifier"
```

---

## Task 5: Realtime + data hook (`use-retro`)

**Files:**
- Create: `src/lib/retro/local-identity.ts`, `src/lib/hooks/use-retro.ts`

Follow `useMeetingRealtime`/`useMeetingPresence` (`src/lib/hooks/use-meetings.ts`) closely.

- [ ] **Step 1: local identity helpers**

```ts
// src/lib/retro/local-identity.ts  ("use client" consumers only)
const rand = () => crypto.randomUUID().replace(/-/g, "");
export function participantKey(boardToken: string): string {
  const k = `retro:pk:${boardToken}`; let v = localStorage.getItem(k);
  if (!v) { v = rand(); localStorage.setItem(k, v); } return v;
}
export function saveFacilitatorToken(boardToken: string, ft: string) { localStorage.setItem(`retro:ft:${boardToken}`, ft); }
export function facilitatorToken(boardToken: string): string | null { return localStorage.getItem(`retro:ft:${boardToken}`); }
```

- [ ] **Step 2: the hook**

```ts
// src/lib/hooks/use-retro.ts
"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { RetroSnapshot, RetroBroadcast, RetroParticipant } from "@/lib/retro/types";
import { participantKey } from "@/lib/retro/local-identity";

export const retroKeys = { snapshot: (t: string) => ["retro", t] as const };

export function useRetroSnapshot(token: string) {
  const supabase = createClient();
  return useQuery<RetroSnapshot>({
    queryKey: retroKeys.snapshot(token),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("retro_snapshot", { p_token: token });
      if (error) throw error;
      return data as RetroSnapshot;
    },
    refetchInterval: 3000, // reconcile; broadcast handles instant updates
  });
}

// Thin RPC callers; each broadcasts after a successful write.
export function useRetroActions(token: string, boardId: string) {
  const supabase = createClient();
  const qc = useQueryClient();
  const channelRef = React.useRef<ReturnType<typeof supabase.channel> | null>(null);
  const broadcast = (payload: RetroBroadcast) =>
    channelRef.current?.send({ type: "broadcast", event: "retro", payload });
  const refresh = () => qc.invalidateQueries({ queryKey: retroKeys.snapshot(token) });
  return { setChannel: (c: typeof channelRef.current) => (channelRef.current = c), broadcast, refresh,
    rpc: async (fn: string, args: Record<string, unknown>, ev?: RetroBroadcast) => {
      const { data, error } = await supabase.rpc(fn, args); if (error) throw error;
      if (ev) broadcast(ev); refresh(); return data; } };
}

// Broadcast + presence channel on retro:{boardId}
export function useRetroChannel(boardId: string, me: { participant_key: string; name: string; color: string }, onEvent: (e: RetroBroadcast) => void, onPresence: (p: RetroParticipant[]) => void) {
  React.useEffect(() => {
    if (!boardId) return;
    const supabase = createClient();
    const channel = supabase.channel(`retro:${boardId}`, { config: { presence: { key: me.participant_key } } });
    channel.on("broadcast", { event: "retro" }, (m) => onEvent(m.payload as RetroBroadcast));
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{ name: string; color: string; participant_key: string; is_facilitator?: boolean }>();
      onPresence(Object.values(state).map((metas) => metas[0]).map((m) => ({ participant_key: m.participant_key, name: m.name, color: m.color as RetroParticipant["color"], is_facilitator: !!m.is_facilitator })));
    });
    channel.subscribe(async (status) => { if (status === "SUBSCRIBED") await channel.track(me); });
    return () => { void supabase.removeChannel(channel); };
  }, [boardId, me.participant_key]); // eslint-disable-line react-hooks/exhaustive-deps
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm lint && npx tsc --noEmit` (or the repo's typecheck).
Expected: no errors in new files.

- [ ] **Step 4: Commit**

```bash
git add src/lib/retro/local-identity.ts src/lib/hooks/use-retro.ts
git commit -m "feat(retro): realtime snapshot + broadcast/presence hook"
```

---

## Task 6: Scoped Studio tokens

**Files:**
- Create: `src/styles/retro.css`
- Modify: `src/app/globals.css` (add `@import "../styles/retro.css";` after existing imports)

- [ ] **Step 1: Port tokens, scoped under `[data-retro]`**

Copy values from `/Volumes/Mango/Downloads/Minutia Retro Design System/tokens/{colors,typography,spacing,elevation,motion}.css`. Wrap ALL custom properties under `[data-retro="studio"]` (defaults) and `[data-retro="daylight"]` (overrides) so they never leak into the app's `:root` (`--paper`/`--accent` collide otherwise). Map fonts to the app's loaded families:

```css
/* src/styles/retro.css — Studio After Dark, scoped to the retro route only. */
[data-retro] {
  --font-serif: var(--font-fraunces, Georgia, serif);
  --font-sans:  var(--font-satoshi, system-ui, sans-serif);
  --font-mono:  var(--font-jetbrains, ui-monospace, monospace);
  /* spacing/radius/motion: copy from tokens/spacing.css, tokens/motion.css verbatim */
}
[data-retro="studio"] {
  --studio-void: oklch(0.16 0.008 70); --studio-surface: oklch(0.20 0.010 70);
  --studio-raised: oklch(0.245 0.010 70); --studio-line: oklch(0.30 0.008 70);
  --studio-line-2: oklch(0.38 0.008 70); --studio-ink: oklch(0.95 0.004 70);
  --studio-ink-2: oklch(0.78 0.006 70); --studio-ink-3: oklch(0.62 0.006 70);
  --paper: oklch(0.94 0.012 85); --card-ink: oklch(0.22 0.010 70);
  --c-amber: oklch(0.90 0.060 75); --c-rose: oklch(0.88 0.055 25); --c-sage: oklch(0.89 0.048 150);
  --c-sky: oklch(0.89 0.045 235); --c-lilac: oklch(0.88 0.050 300); --c-sand: oklch(0.92 0.028 90);
  --accent: oklch(0.68 0.205 35); --accent-bright: oklch(0.745 0.210 35);
  --accent-deep: oklch(0.58 0.200 35); --accent-soft: oklch(0.30 0.060 35); --accent-rgb: 233 98 60;
  --success: oklch(0.62 0.130 155); --warn: oklch(0.62 0.140 85); --danger: oklch(0.60 0.165 25);
  --glow-accent: 0 0 0 1px rgb(var(--accent-rgb) / 0.50), 0 0 24px rgb(var(--accent-rgb) / 0.35);
  --glow-reveal: 0 0 40px rgb(248 122 78 / 0.45);
  --lift-card: inset 0 1px 0 rgb(255 255 255 / 0.10), 0 2px 4px rgb(0 0 0 / 0.30), 0 12px 28px rgb(0 0 0 / 0.45);
  --lift-drag: inset 0 1px 0 rgb(255 255 255 / 0.14), 0 18px 48px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(var(--accent-rgb) / 0.40);
  --lift-panel: 0 24px 64px rgb(0 0 0 / 0.50);
  --r-chip: 8px; --r-control: 10px; --r-card: 14px; --r-panel: 18px; --r-pill: 9999px;
  --ease-out: cubic-bezier(0.2,0.8,0.2,1); --ease-spring: cubic-bezier(0.34,1.56,0.64,1);
  --dur-instant: 90ms; --dur-fast: 140ms; --dur-base: 200ms; --dur-slow: 360ms; --dur-ritual: 600ms; --dur-grand: 900ms; --stagger-card: 40ms;
  color-scheme: dark;
}
[data-retro="daylight"] {
  --studio-void: oklch(0.985 0 0); --studio-surface: oklch(0.955 0 0); --studio-raised: oklch(1 0 0);
  --studio-line: oklch(0.91 0 0); --studio-line-2: oklch(0.84 0 0); --studio-ink: oklch(0.18 0 0);
  --studio-ink-2: oklch(0.42 0.004 70); --studio-ink-3: oklch(0.58 0.004 70);
  --paper: oklch(0.98 0.010 85); --card-ink: oklch(0.20 0.010 70);
  --accent: oklch(0.490 0.220 35); --accent-bright: oklch(0.58 0.220 35);
  --accent-deep: oklch(0.430 0.200 35); --accent-soft: oklch(0.92 0.040 35); --accent-rgb: 187 64 29;
  color-scheme: light;
}
@media (prefers-reduced-motion: reduce) {
  [data-retro] * { --dur-ritual: 0ms; --dur-grand: 0ms; --stagger-card: 0ms; }
}
```

- [ ] **Step 2: Verify no global leakage**

Run: `pnpm dev`, open the existing dashboard `/`, confirm app colors unchanged (the retro tokens are inert without `[data-retro]`).
Expected: app theme identical to before.

- [ ] **Step 3: Commit**

```bash
git add src/styles/retro.css src/app/globals.css
git commit -m "feat(retro): scoped Studio After Dark design tokens"
```

---

## Task 7: Port core + retro components

**Files:**
- Create under `src/components/retro/`: `Button.tsx`, `IconButton.tsx`, `Badge.tsx`, `Avatar.tsx`, `Tag.tsx`, `Input.tsx`, `Switch.tsx`, `RetroCard.tsx`, `PhaseBar.tsx`, `VoteTally.tsx`, `PresenceStack.tsx`, `CarryoverItem.tsx`, `CardEditor.tsx`, `CommitPanel.tsx`, `CreateRetro.tsx`, `ShareInvite.tsx`, `Spotlight.tsx`, `Lobby.tsx`, `Board.tsx`.

**Port procedure (per component):** Read the prototype at `/Volumes/Mango/Downloads/Minutia Retro Design System/components/**` and `ui_kits/retro-board/**`. Transform: (1) drop the `window.MinutiaRetroDesignSystem_*` namespace, export a typed React component; (2) keep the inline `style={{ ... }}` (it already references the scoped CSS vars — fastest faithful port, no Tailwind translation needed); (3) add TS prop types from `src/lib/retro/types.ts`; (4) replace `window.Icons.*` with `lucide-react` imports; (5) ensure `prefers-reduced-motion` paths exist; (6) no `dangerouslySetInnerHTML` (XSS).

- [ ] **Step 1: Port `core` + `forms` components**

Port `Button, IconButton, Badge, Avatar, Tag` from `components/core/*.jsx` and `Input, Switch` from `components/forms/*.jsx` 1:1 into `src/components/retro/*.tsx` with prop types. Verify each renders in isolation (Storybook not required; a scratch route or the board will exercise them).

- [ ] **Step 2: Port `retro` primitives**

Port `RetroCard, PhaseBar, VoteTally, PresenceStack, CarryoverItem` from `components/retro/*.jsx`. `RetroCard` must support `faceDown` (back texture) and a flip transform driven by a `revealed` prop using Motion (`rotateY`), GPU-composited.

- [ ] **Step 3: Port board surfaces**

Port `Lobby, Board, CardEditor, CommitPanel, CreateRetro, ShareInvite, Spotlight` from `ui_kits/retro-board/*.jsx`. Replace the prototype's local `useState` data with props fed from `RetroClient` (Task 8). Keep layout/markup identical.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/retro
git commit -m "feat(retro): port Studio design-system components to typed React"
```

---

## Task 8: Routes + board orchestration (single-context first)

**Files:**
- Create: `src/app/(retro)/layout.tsx`, `retro/page.tsx`, `retro/[token]/page.tsx`, `retro/[token]/RetroClient.tsx`, `retro/disabled/page.tsx`

- [ ] **Step 1: Layout sets the studio theme + enabled gate**

```tsx
// src/app/(retro)/layout.tsx
import { getInstanceConfigMap } from "@/lib/instance-config";
import { redirect } from "next/navigation";
export default async function RetroLayout({ children }: { children: React.ReactNode }) {
  const cfg = await getInstanceConfigMap(["retro_enabled"]);
  if (cfg.retro_enabled !== "true") redirect("/retro/disabled");
  return <div data-retro="studio" style={{ minHeight: "100vh", background: "var(--studio-void)" }}>{children}</div>;
}
```
(Place `disabled/page.tsx` OUTSIDE the gate, e.g. render it without the flag check — use a sibling segment or check inside it to avoid redirect loop. Simplest: `disabled/page.tsx` is a plain page; the layout's redirect target bypasses re-entry because the layout allows it when flag is false only via the disabled route — guard with `if (cfg.retro_enabled !== "true" && !isDisabledRoute) redirect`. Implement by reading the path via a server header or split disabled into its own non-gated route group.)

- [ ] **Step 2: Create page (template picker) + board page (snapshot)**

`retro/[token]/page.tsx` (server) calls `retro_snapshot` via the server anon client for SSR initial state, passes to `RetroClient`. On expired/missing → friendly "this board has expired" view.

- [ ] **Step 3: RetroClient orchestration**

`RetroClient.tsx` (`use client`) wires `useRetroSnapshot`, `useRetroChannel`, `useRetroActions`, the phase state machine (PHASES = Lobby…Commit, from `App.jsx`), the Reveal cascade effect (from `App.jsx` lines 35–43, gated on `prefers-reduced-motion`), and renders `Board`/`Lobby`/`CommitPanel`/`Spotlight`. Facilitator controls render only when `facilitatorToken(token)` is present.

- [ ] **Step 4: Manual run — single context**

Run: `pnpm dev`; set `retro_enabled=true` in instance_config; visit `/retro`, create a board, write cards, step phases, see the Reveal.
Expected: full ritual works in one browser; cards persist across reload (snapshot RPC).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(retro)"
git commit -m "feat(retro): /retro routes + board orchestration"
```

---

## Task 9: Realtime multiplayer wiring

- [ ] **Step 1: Broadcast on every mutation**

In `RetroClient`, after each `rpc()` success, broadcast the matching `RetroBroadcast` event; on receiving an event, invalidate the snapshot query (instant peer update). Presence feeds `PresenceStack` (avatars) and live cursors (throttle pointer move to ~30Hz, broadcast `cursor` events — optional, behind a flag if time-constrained).

- [ ] **Step 2: Synchronized Reveal**

Facilitator advancing to `reveal` calls `retro_set_phase` → broadcasts `phase.changed`. All clients run the cascade effect on entering `reveal`. Verify both contexts flip together.

- [ ] **Step 3: Manual two-context test**

Open `/retro/[token]` in two browser profiles; join as two people; confirm presence avatars, live card adds, synchronized reveal, live vote bars.
Expected: < ~300ms perceived sync; reconcile repairs any missed event within 3s.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(retro)" src/lib/hooks/use-retro.ts
git commit -m "feat(retro): realtime presence, broadcast sync, synchronized reveal"
```

---

## Task 10: AI theme suggestions

**Files:**
- Create: `src/app/api/retro/[token]/suggest-themes/route.ts`

- [ ] **Step 1: Route**

Mirror `src/app/api/series/[seriesId]/ask/route.ts`. Load cards via service-role using the board token; if `getOpenRouterApiKey()` is null → `503`. Build a clustering prompt; `callOpenRouter`; return `{ groups: [{ label, card_ids }] }`. Rate-limit (reuse middleware; add per-token cooldown). Never auto-apply.

- [ ] **Step 2: UI chip**

In `Board` Theme phase, fetch suggestions; render the existing quiet chip ("N cards look related — 'label'. Cluster them?"); on accept → `retro_set_card_group` (facilitator) + broadcast.

- [ ] **Step 3: Manual test (with and without key)**

Expected: with `OPENROUTER_API_KEY` set, chip appears with a real grouping; without, chip is silently absent (no error toast).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/retro" "src/app/(retro)"
git commit -m "feat(retro): AI theme-clustering suggestions (graceful degrade)"
```

---

## Task 11: Graduation + export + nudge

**Files:**
- Create: `src/app/api/retro/[token]/graduate/route.ts`
- Modify: `CommitPanel.tsx` (wire export + nudge CTAs)

- [ ] **Step 1: Graduate route (auth-gated)**

```ts
// POST body: { target: "new"; name: string } | { target: "existing"; series_id: string }
// 1. const supabase = await createClient(); requireUser() else 401.
// 2. Load board (service-role) by token; load retro_actions.
// 3. If target==="new": insert meeting_series { name, owner_id: user.id, organization_id: profile.current_organization_id }.
//    Else verify the user can access series_id.
// 4. Insert a "Retrospective" meeting in that series (raised_in_meeting target).
// 5. For each action: insert issues { series_id, raised_in_meeting_id, title: action.text, category:'action',
//    source:'retro', owner_name, due_date: parseDue(action.due), priority: votesToPriority }.
// 6. Update retro_actions.graduated_issue_id; set retro_boards.saved_to_series_id + claimed_by; expires_at = null (persist).
// 7. Return { series_id, issue_count }.
```
Server derives ownership from the session — never from the client. Respects the instance signup policy (unauthenticated users hit login with `?next=/retro/{token}?graduate=1`).

- [ ] **Step 2: Free markdown export**

`CommitPanel` "Export markdown" button calls `boardToMarkdown(snapshot)` → clipboard + `.md` download. No network, no auth. Sits beside the save CTA always.

- [ ] **Step 3: The nudge**

Render the calm nudge card (not a modal wall): "Keep these alive in Minutia so your next retro starts with what's still open." Primary accent → graduate (auth if needed); secondary quiet "just export markdown". On success → closure bloom + link to the new series.

- [ ] **Step 4: Manual test**

Authed user: Commit → Save to Minutia (new series) → verify a series + N issues created with `source='retro'`. Existing user: append to an existing series. Anonymous: Save → redirected to login with correct `next`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/retro" src/components/retro/CommitPanel.tsx
git commit -m "feat(retro): account-gated graduation + free markdown export"
```

---

## Task 12: Middleware, admin toggle, disabled page

**Files:**
- Modify: `middleware.ts`, admin runtime-settings UI
- Create: `src/app/(retro)/retro/disabled/page.tsx` (if not already in Task 8)

- [ ] **Step 1: Middleware exemptions**

Add `/retro` and `/api/retro` to BOTH `publicPaths` and `setupExemptPaths` in `middleware.ts`. Keep security headers + rate limiting applied. Verify a logged-out user on a fresh (unsetup) instance can reach `/retro` (when enabled) without setup/login redirect.

- [ ] **Step 2: Admin toggle**

The admin settings UI is `src/app/(app)/settings/page.tsx`; it persists via `src/app/api/admin/config/route.ts` (the `instance_config` writer). Add a `retro_enabled` boolean toggle to the settings form and ensure `config/route.ts` accepts the key (check for an allow-list of writable keys and add `retro_enabled` if present). Label: "Enable free retro boards (public, no-login)". Helper text: "Opens a public, unauthenticated board surface on this instance."

- [ ] **Step 3: Disabled page**

Tasteful "Free retro boards aren't enabled on this instance." with a link home. No app chrome leakage.

- [ ] **Step 4: Manual test both states**

Expected: flag off → `/retro` shows disabled page, `/api/retro/*` 404/redirect; flag on → tool works.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts "src/app/(app)/settings" "src/app/(retro)"
git commit -m "feat(retro): middleware exemptions + admin enable toggle"
```

---

## Task 13: E2E tests

**Files:**
- Create: `e2e/regression/retro-create.spec.ts`, `retro-ritual.spec.ts`, `retro-multiplayer.spec.ts`, `retro-graduate.spec.ts`, `retro-disabled.spec.ts`

Use `storageState: { cookies: [], origins: [] }` for anonymous specs (per CLAUDE.md). Seed `retro_enabled=true` in the E2E DB setup. Use two `browser.newContext()` for multiplayer. Follow E2E patterns in CLAUDE.md (`.first()`, `{ exact: true }`, combobox roles).

- [ ] **Step 1: Write specs (one behavior per test)**

Cover: create board + share link; Reflect hides others' cards; Reveal flips all; Vote tallies + budget exhaustion; Discuss spotlight; Commit seals; carryover closure beat; export markdown (no auth); over-cap card rejected; non-facilitator cannot advance; expired board view; disabled-instance page; authed graduation seeds series + issues (`source='retro'`).

- [ ] **Step 2: Run the new specs**

Run: `pnpm test:e2e -- retro-`
Expected: all pass locally (note: some env-dependent failures per memory `project_local_e2e_env_failures` are unrelated; retro specs must pass).

- [ ] **Step 3: Full suite + verifiers**

Run: `pnpm test:retro && pnpm test:oss-boundaries && pnpm test:query-contracts && pnpm test:e2e`
Expected: green (modulo the known JST/env-only failures documented in memory).

- [ ] **Step 4: Commit**

```bash
git add e2e/regression/retro-*.spec.ts
git commit -m "test(retro): E2E coverage incl. two-context multiplayer + graduation"
```

---

## Task 14: Review loop + docs

- [ ] **Step 1: Two independent code reviews** (per CLAUDE.md): dispatch a fresh-context reviewer over the full diff against this spec; a second pass on security (RLS default-deny, SECURITY DEFINER search_path, token entropy, no anon table grants, XSS, ownership-on-server). Fix findings; re-run verifiers + lint + typecheck after each fix pass.

- [ ] **Step 2: OSS boundary scan**

Run: `pnpm test:oss-boundaries` and a manual scan for any billing/plan/upgrade code — confirm the "add members → upgrade" path is a no-op seam, not implemented here.
Expected: clean.

- [ ] **Step 3: Docs**

Update `CLAUDE.md` "What Has Been Done" (add Retro), append a `20260616_*` line to the migrations list, and add a `CHANGELOG.md` entry. Document the `retro_enabled` flag + cron-or-read-side expiry in the self-host docs.

- [ ] **Step 4: Commit + open PR**

```bash
git add -A && git commit -m "docs(retro): changelog, claude.md, self-host notes"
git push -u origin feat/minutia-retro
gh pr create --fill
```

---

## Self-Review (against spec)

- **Routing/flag** → Tasks 8, 12. **Anon-realtime crux (RPC writes + broadcast + default-deny)** → Tasks 1,2,5,9. **Identity without auth** → Task 5. **Data model + issues.source** → Task 1. **RPCs** → Task 2. **Expiry/cleanup** → Task 3. **AI suggestions** → Task 10. **Graduation + export + nudge + auth seam** → Task 11. **Design port + scoped tokens + two beats** → Tasks 6,7,8. **Security/abuse** → Tasks 1,2,12,14. **Testing** → Tasks 4,13. **Boundary cleanliness** → Tasks 1,11,14. No placeholders; types (`RetroSnapshot`, `RetroBroadcast`, RPC arg names `p_token`/`p_key`/`p_ftoken`) consistent across tasks. Flagged: verifier TS-import style must match the existing `verify-carryover.test.mjs` loader (Task 4 Step 1 note); disabled-route redirect-loop guard (Task 8 Step 1 note).
