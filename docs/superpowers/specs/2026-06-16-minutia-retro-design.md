# Minutia Retro — Free Collaborative Retro Board (Design Spec)

**Date:** 2026-06-16
**Status:** Design, pending approval → implementation plan.
**Sources:** `docs/research/retro-board.md` (product concept), `docs/research/retro-board-design.md` + `retro-board-tokens.json` (design system), `~/Downloads/Minutia Retro Design System/` (Claude-built UI kit + components), this codebase's share-token / realtime / AI / issues patterns.

---

## 1. What we are building

A free, instant, multiplayer retrospective board ("Minutia Retro — The Studio After Dark") that lives **inside this app at `/retro`**. No login to create or run. A guided 7-phase ritual (Lobby → Reflect → Reveal → Theme → Vote → Discuss → Commit) with a synchronized **Reveal** (all cards flip at once) and a **Close** bloom. Boards are anonymous and ephemeral (auto-expire 30 days). The funnel: at Commit, action items "graduate" into Minutia as tracked issues — which requires an account. Markdown export is free forever, no auth.

**This is the disguised acquisition funnel for Minutia.** The retro is a genuine gift; the continuity (action items that don't die) is the product.

### In scope (this build)
- Full 7-phase ritual UI, ported from the design system to production Next.js + Tailwind v4.
- Anonymous create + join, no auth.
- Realtime multiplayer: presence (avatars + live cursors), broadcast sync, synchronized Reveal.
- The two choreographed moments: The Reveal cascade, The Close bloom.
- Living carryover rail ("Still open") from a previous retro.
- AI theme-clustering **suggestions** (reuse OpenRouter pipeline; graceful degrade if no key).
- Graduation: account-gated "Save to Minutia" → new series (new user) or append to existing series (existing user).
- Free Markdown/clipboard export (no auth).
- 30-day auto-expiry, rate limits, input caps, XSS-safe.

### Explicitly NOT in scope (YAGNI / boundary)
- Subdomain `retro.getminutia.com` (cloud rewrite later; OSS stays path-based).
- Billing, plans, "upgrade to add members" (lives in `minutia-cloud`). We build the *seam*, not the paywall.
- Self-serve public signup provisioning (cloud concern; OSS respects the instance's existing signup policy).
- Drag-to-reorder clustering physics, sound files v1 (sound toggle present, cues optional/deferred), infinite whiteboard, integrations other than Minutia, analytics/team-health radar.

---

## 2. Hosting & routing

- New **public route group** `src/app/(retro)/retro/...`:
  - `/retro` — create / template picker (landing for the tool).
  - `/retro/[token]` — the live board (the hero). Reads board by capability token.
- Middleware: add `/retro` and `/api/retro` to `publicPaths` **and** to `setupExemptPaths` so the tool works on a fresh instance and without auth. Gate availability behind an instance flag (below).
- Cloud later maps `retro.getminutia.com` → `/retro` via a rewrite in `minutia-cloud`; nothing host-specific in this repo.

### Availability flag (self-host safety)
- New `instance_config` key **`retro_enabled`** (`'true'`/`'false'`). Read in middleware/layout.
- Default: **off** for self-host (operator consciously opens a public, no-auth surface). Hosted cloud sets it on. When off, `/retro` returns a tasteful "not enabled on this instance" page; `/api/retro/*` returns 404.
- Surfaced in the existing admin runtime-settings UI as a toggle.

---

## 3. Architecture: the anonymous-realtime crux

A public, no-auth, realtime board cannot expose tables to `anon` SELECT (that makes every board world-readable via PostgREST and is an enumeration/abuse surface). Resolution, matching the research threat-model:

**Writes → `SECURITY DEFINER` RPCs.** All anonymous mutations go through stored procedures that validate the board token, the participant key, expiry, rate limits, caps, and input length/escaping server-side, then perform the insert/update. `anon` has **no direct table grants** on `retro_*`.

**Reads (initial state) → `SECURITY DEFINER` RPC** `retro_snapshot(board_token)` returning the full board state as JSON.

**Liveness → Supabase Realtime Broadcast + Presence**, keyed on the unguessable board UUID (channel `retro:{boardId}`):
- **Broadcast** events: `card.added`, `card.updated`, `card.deleted`, `vote.changed`, `phase.changed`, `action.changed`, `carry.toggled`. Ephemeral pub/sub; no table RLS involved.
- **Presence**: participant avatars (name + pastel color + facilitator flag), throttled live cursors.
- A **periodic snapshot reconcile** (every ~3s, mirroring the existing 2s meeting-poll pattern) calls `retro_snapshot` to repair any missed broadcast — broadcast is best-effort; the DB (via RPC) is authoritative.

This keeps `retro_*` tables fully closed to `anon` while still delivering live collaboration. Facilitator-only actions (advance phase, end reflection → trigger reveal) require the **facilitator token** (a second secret minted at create time, held only by the creator in `localStorage`).

### Identity without auth
- On first visit, the client generates a stable **`participant_key`** (random, stored in `localStorage` per board) and picks/gets assigned a pastel color. Name entered at the Lobby. The participant_key authorizes that guest's own card edits/votes in the RPCs. No PII, no account.

---

## 4. Data model (new migration `20260616_retro_boards.sql`)

All tables prefixed `retro_`. RLS **enabled, default-deny for `anon`**; access only through the RPCs below.

- **retro_boards**
  - `id uuid pk default gen_random_uuid()`
  - `token text unique not null default encode(gen_random_bytes(18),'hex')` — share/capability token
  - `facilitator_token text not null default encode(gen_random_bytes(18),'hex')` — secret, creator-only
  - `name text not null`
  - `template text not null` (`msg|ssc|4ls|fire`)
  - `columns jsonb not null` — `[{id,title}]`
  - `phase text not null default 'lobby'` (`lobby|reflect|reveal|theme|vote|discuss|commit|closed`)
  - `phase_started_at timestamptz` — drives timers
  - `settings jsonb not null default '{}'` — sound, vibe, reflect-duration
  - `previous_board_id uuid references retro_boards(id)` — carryover chain
  - `saved_to_series_id uuid references meeting_series(id)` — set on graduation
  - `claimed_by uuid references profiles(id)` — converting user
  - `created_at`, `updated_at timestamptz`
  - `expires_at timestamptz not null default now() + interval '30 days'` — cleared on save
- **retro_participants** — `id`, `board_id fk`, `participant_key text`, `name`, `color`, `is_facilitator bool`, `user_id uuid null`, `last_seen_at`, `created_at`; unique `(board_id, participant_key)`.
- **retro_cards** — `id`, `board_id fk`, `column_id text`, `author_key text`, `author_name`, `color`, `text text` (length-capped, escaped on render), `group_id uuid null` (theme cluster), `sort_order int`, `created_at`, `updated_at`.
- **retro_votes** — `id`, `board_id fk`, `card_id uuid fk`, `voter_key text`, `created_at`; unique `(board_id, card_id, voter_key)`; per-voter cap enforced in RPC (dot-voting budget).
- **retro_actions** — `id`, `board_id fk`, `text`, `owner_name`, `due text` (free-form: "Fri"/"Next sprint"), `color`, `source_card_id uuid null`, `graduated_issue_id uuid null references issues(id)`, `sort_order`, `created_at`.

Migration also: `ALTER TABLE issues` to add `'retro'` to the `source` CHECK constraint. Index `retro_boards(token)`, `retro_boards(facilitator_token)`, `retro_boards(expires_at)`, and `board_id` on children.

### Expiry / cleanup
- A Supabase scheduled function (`pg_cron` if available, else documented manual/edge cron) deletes boards where `expires_at < now()` and `saved_to_series_id is null`, cascading children. For OSS without pg_cron, expiry is also enforced **read-side**: `retro_snapshot` returns "expired" for stale unsaved boards, and a lightweight cleanup runs opportunistically. (Cron wiring documented; no runtime topology in repo.)

---

## 5. RPCs (Postgres, `SECURITY DEFINER`)

Each validates: board exists + not expired; for guest writes, `participant_key` belongs to board; rate/caps; for facilitator writes, `facilitator_token` matches.

- `retro_create(name, template, columns jsonb, previous_token text default null)` → `{board_id, token, facilitator_token, participant_key}` (creator becomes facilitator). Rate-limited by IP (middleware) + global per-minute cap.
- `retro_snapshot(board_token)` → full JSON: board, columns, participants, cards (face-down state resolved client-side per phase), votes (aggregated), actions, carryover (open actions/issues from `previous_board_id` or saved series).
- `retro_join(board_token, participant_key, name, color)` → participant row (upsert). Caps participants/board.
- `retro_add_card(board_token, participant_key, column_id, text, color)` → card. Caps cards/board + per-participant/min. Length cap (≤ 280). 
- `retro_update_card(board_token, participant_key, card_id, text, color)` — only own card (or facilitator).
- `retro_delete_card(board_token, participant_key, card_id)` — own or facilitator.
- `retro_set_card_group(facilitator_token, card_ids[], group_id)` — clustering (facilitator).
- `retro_vote(board_token, participant_key, card_id, delta)` — +/- a dot; enforces per-voter budget.
- `retro_set_phase(facilitator_token, phase)` — advances ritual; stamps `phase_started_at`.
- `retro_add_action(facilitator_token, text, owner_name, due, color, source_card_id)` / `retro_update_action` / `retro_delete_action`.
- `retro_toggle_carry(board_token, participant_key, carry_id, done)` — closure beat.

Clients call RPCs (anon Supabase client), then **broadcast** the corresponding event on `retro:{boardId}` for instant peer update; snapshot reconcile covers drops.

---

## 6. AI theme clustering (suggestions only)

- Route `POST /api/retro/[token]/suggest-themes` (thin BFF). Loads cards via service-role/RPC, calls `callOpenRouter` (`src/lib/ai/openrouter.ts`) with a clustering prompt, returns `[{label, card_ids[]}]`. 
- "Suggests, never auto-merges." UI shows a quiet chip ("3 cards look related — 'deploys & staging'. Cluster them?"); facilitator accepts → `retro_set_card_group`.
- Graceful: if `getOpenRouterApiKey()` is null → 503, UI simply hides the suggestion chip. Rate-limited; anon-allowed.

---

## 7. Graduation (the funnel handoff)

- Free path (no auth): **Export markdown** — pure client function, always available, sits beside the save CTA. No gate, no resentment.
- Save path (account-gated): `POST /api/retro/[token]/graduate` (auth required).
  - Body: `{ target: 'new', name } | { target: 'existing', series_id }`.
  - Server (user-scoped server client): resolves user + `current_organization_id`; if `new`, `useCreateSeries`-equivalent insert; creates a "Retrospective" meeting; inserts each `retro_actions` row as an `issues` row (`category:'action'`, `source:'retro'`, `owner_name`, `due_date` parsed best-effort, `priority` by votes); sets `retro_actions.graduated_issue_id`, `retro_boards.saved_to_series_id` + `claimed_by`, clears `expires_at`.
  - Carryover continuity: future retros created "from" this board/series pull open issues via the existing `carryover.ts` summarizer.
- **Auth/signup seam:** "Save" routes anonymous users through login/signup with `?next=/retro/{token}?graduate=1`, honoring the instance's existing signup policy (invite-only on vanilla self-host; hosted cloud opens free individual signup). The "add more members → upgrade" CTA is a **cloud-only** hook; in OSS, members are added via the existing workspace invite flow. No billing code here.

---

## 8. Design system port (production, not the prototype)

The `~/Downloads/Minutia Retro Design System/` kit is inline-style JSX on a global namespace (`window.MinutiaRetroDesignSystem_*`) — a prototype. We port it to real Next.js client components under `src/components/retro/` using Tailwind v4 + CSS variables, reusing the app's already-loaded fonts (`--font-satoshi`/`fraunces`/`jetbrains`).

- **Tokens:** add the "Studio After Dark" tokens (`--studio-void/surface/raised/line/ink*`, `--paper`, `--card-ink`, six `--c-*` pastels, `--accent-soft`, `--glow-accent`, `--glow-reveal`, ritual motion durations) to `globals.css`, **scoped under a `[data-retro="studio"]` / `[data-retro="daylight"]` wrapper** on the retro route so the main app theme is untouched. Map `--font-serif → --font-fraunces`, `--font-sans → --font-satoshi`, `--font-mono → --font-jetbrains`.
- **Components** (ported, typed, a11y, reduced-motion aware):
  - `core`: `Button`, `IconButton`, `Badge`, `Avatar`, `Tag`, form `Input`/`Switch` (or reuse shadcn where it fits).
  - `retro`: `RetroCard` (paper sticky w/ tilt, face-down, flip), `PhaseBar`, `VoteTally`, `PresenceStack`, `CarryoverItem`, `CardEditor`, `CommitPanel` (+ Minutia nudge), `CreateRetro`, `ShareInvite`, `Spotlight`, `Lobby`, `Board`.
  - Icons: Lucide (already viable; app convention).
- **The two beats:** Reveal = per-card `rotateY(180→0)` cascade (`stagger-card` 40ms, center-out) with a one-frame `--glow-reveal`; Close = action seal `--glow-accent` then a single `grand` bloom. Both GPU-composited (transform/opacity), reduced-motion → staggered crossfade. Motion via Motion lib (already in stack).
- Performance budgets honored: 60fps drag, throttled cursors (~20–30Hz), board cold render < 1.5s, smooth at ~12 users / ~80 cards.

---

## 9. Security & abuse (designed in)

- Default-deny RLS on all `retro_*`; only `SECURITY DEFINER` RPCs (search_path-pinned) touch them. `anon` granted EXECUTE on the public RPCs only.
- Capability tokens unguessable (≥144-bit). Facilitator token never sent to non-creators; never in URLs.
- Rate limits: per-IP board creation (middleware), per-participant card/vote/min (RPC), board caps (cards ≤ 200, participants ≤ 25, vote budget ≤ N). Input length caps; all card/action text escaped on render (React default + no `dangerouslySetInnerHTML`).
- Broadcast channels keyed on unguessable board UUID; events carry no secrets. Presence carries name + color only.
- Graduation never trusts client-claimed ownership: server derives the owning user/org from the session.
- Ephemeral by default (30-day expiry); cleared only on explicit save.
- `pnpm test:oss-boundaries` must stay green (no `minutia-ops`/`minutia-cloud` symbols; the upgrade/billing seam is a no-op interface here).

---

## 10. Testing (TDD, merge gates)

- **Contract verifiers** (`scripts/verify-*.mjs`, node:test): RPC argument/return shapes; snapshot JSON shape; rate-limit/cap logic (pure functions extracted where possible, e.g. vote-budget, due-date parse, carryover summarize reuse).
- **Playwright E2E** (`e2e/regression/retro-*.spec.ts`, unauthenticated storage state):
  - Create board → share link → join as second context → both see cards (two browser contexts for true multiplayer).
  - Reflect hides others' cards; Reveal flips all; Vote tallies; Discuss spotlight; Commit seals.
  - Carryover rail closure beat.
  - Export markdown (no auth). Graduate requires auth → seeds a series + issues (authed context).
  - `retro_enabled` off → `/retro` shows disabled page; `/api/retro` 404.
  - Edge cases: expired board, over-cap card add rejected, non-facilitator cannot advance phase, vote budget exhausted, empty carryover state, reduced-motion path.
- 90%+ functional coverage on new code. Full `pnpm test:e2e` + `pnpm test:oss-boundaries` + `pnpm test:query-contracts` before merge.

---

## 11. Build sequence (high level — detailed plan follows)

1. Migration + RPCs + RLS + `instance_config` flag + boundary/expiry. Contract verifiers first (TDD).
2. Supabase clients/hooks: `use-retro` (snapshot query, RPC mutations, broadcast+presence, reconcile).
3. Token system + globals scoping + ported `core` components.
4. Ported `retro` components + `Board`/phase orchestration (single-context first).
5. Realtime wiring: presence, broadcast, synchronized Reveal, reconcile.
6. AI suggest-themes route + UI chip.
7. Graduation route + auth seam + Markdown export + Minutia nudge.
8. Admin toggle, middleware exemptions, disabled-state page.
9. E2E + verifiers + two-context multiplayer tests; review loop (two passes); docs + CHANGELOG.

---

## 12. Open items (resolved defaults, flagged)
- `retro_enabled` default **off** on self-host (safety); cloud enables. (Revisit if Pratik wants it on by default.)
- pg_cron availability varies by host → expiry also enforced read-side; cron wiring documented, not hard-coded.
- Sound cues deferred (toggle present, files later).
