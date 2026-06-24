# Reminders + Admin Panel — Design (2026-06-24)

Source: `/goal` to assess remaining Paperclip stories, prioritize by product impact, and ship 10
TDD + regression-gated, with a staging deploy trigger. Product-owner, designer, architect, and
marketing lenses applied. UX must be fluid, zero clutter.

## Scope decision

67 open Paperclip stories. After removing out-of-boundary work the OSS self-host repo must NOT
contain:

- **15 hosted-cloud** (→ `minutia-cloud`): MIN-070/071/072/073/074/076/077/080/081/113/114/116/117/118
  (Stripe, free-tier limits, Plausible, Sentry, Vercel, Supabase Cloud, multi-tenant index drop,
  public self-signup, domain/team upsell).
- **2 ops** (→ `minutia-ops`): MIN-111, MIN-126.
- **1 landing** (→ `minutia-landing`): MIN-075.
- **7 stale-done** (already shipped, mirror not updated): MIN-012/084/085/086/087/119/115.

The remaining high-leverage OSS work collapses into **two coherent surfaces** (not 10 scattered
buttons — directly serving the "no clutter" directive):

### Epic A — One-Click Reminders (close the OIL loop + viral distribution)

Minutia's premise is that issues get chased *between* meetings. Today nothing nudges owners.
Email infra already exists (`src/lib/email.ts`, Resend + SMTP via `instance_config`), so net-new
is: a reminder engine, a channel cascade, one clean action surfaced on the series/meeting screens,
and "Sent via Minutia" branding that turns every reminder into organic distribution (marketing
baked into the product loop).

### Epic B — Admin / Instance Panel (self-host operator completeness)

Operators currently have only a buried `retro_enabled` toggle inside `/settings`. Net-new is a
dedicated, fluid `/admin` surface: runtime config (SMTP, flags, instance identity), an overview
dashboard, consolidated user management, and a real health check.

## The 10 (build order)

| # | Story | Surface | Net-new |
|---|-------|---------|---------|
| 1 | MIN-090 Reminders engine + channel cascade | `src/lib/reminders/` | engine, payload, cascade |
| 2 | MIN-094 Clipboard fallback (rich formatting) | lib | markdown/plain formatter |
| 3 | MIN-093 Slack/webhook channel | lib + route | generic outgoing webhook + Slack block |
| 4 | MIN-091 Reminders button (series + meeting) | screen | `RemindOwnersButton` + dialog |
| 5 | MIN-095 "Sent via Minutia" branding + CTA | marketing | footer in every channel payload |
| 6 | MIN-103 Admin layout + guard + sidebar link | screen | `/admin` route group, server guard |
| 7 | MIN-106 Instance runtime-config UI | screen | SMTP/flags/identity editor |
| 8 | MIN-105 User management (consolidated) | screen | move members UI into `/admin/users` |
| 9 | MIN-104 Admin overview dashboard | screen | instance KPIs |
| 10 | MIN-107 Health-check API + status | screen+api | `/api/health` (db/storage/smtp/ai) |

## Architecture

### Reminders (`src/lib/reminders/`)

Pure, testable core separated from delivery:

- `gather.ts` — `gatherOwnerReminders(seriesId, opts)` → groups open issues by owner
  (`assigned_to`), returns `OwnerReminder[] = { owner, email, issues, seriesName }`. Pure given
  rows; queried by the route via service-role.
- `format.ts` — `formatReminder(reminder, channel, appUrl)` → `{ subject, html, text, markdown,
  slackBlocks }`. All payloads end with the **"Sent via Minutia"** branding line + instance URL
  (MIN-095). Pure, fully unit-tested.
- `cascade.ts` — `resolveChannel(config)` picks the channel per the cascade
  **email > slack > webhook > clipboard**: email if SMTP/Resend configured, else slack if
  `slack_webhook_url`, else webhook if `reminder_webhook_url`, else clipboard. Pure.
- Route `POST /api/series/[id]/remind` — thin BFF: authz (series participant), gather, format,
  deliver via resolved channel; returns `{ channel, sent, payload? }` (payload returned only for
  clipboard so the client copies it). Service-role for cross-owner reads.

New `instance_config` keys (non-secret): `slack_webhook_url`, `reminder_webhook_url`.
No DB migration required (instance_config is key/value); reminders read live issue rows.

### Admin panel (`src/app/(app)/admin/`)

- `layout.tsx` — server component; calls `requireAdmin()`-equivalent server check
  (`profiles.role === 'admin'`); redirects non-admins to `/`. Sub-nav: Overview, Settings, Users,
  Health. Reuses the existing token system (`ink`/`paper`/`accent`/`rule`, `font-display`).
- `page.tsx` (Overview, MIN-104) — KPI cards: users, series, meetings, open issues, instance
  name/version, deployment mode. Reads counts via service-role route `GET /api/admin/overview`.
- `settings/page.tsx` (MIN-106) — edits `instance_config`: instance name, SMTP block (host/port/
  user/pass/from, with `smtp-test`), feature flags (`retro_enabled`, reminder channels). Reuses
  existing `GET/PUT /api/admin/config`.
- `users/page.tsx` (MIN-105) — the existing member/invitation management, extracted from
  `settings/page.tsx` into a shared `WorkspaceMembers` component; old settings section links here.
- `health/page.tsx` + `GET /api/admin/health` (MIN-107) — checks db, storage, smtp config, ai
  config; returns `{ service, status: 'ok'|'degraded'|'unconfigured', detail }[]`.
- Sidebar (MIN-110, folded): admin-only "Admin" link rendered when `profile.role === 'admin'`.

### Staging deploy trigger

`.github/workflows/deploy-staging.yml`: `on: workflow_run [CI] completed` + `branches: [main]`,
gated `if conclusion == 'success'`. Sends `repository_dispatch` (`event_type: deploy-staging`) to
the private ops repo via `secrets.OPS_REPO` + `secrets.OPS_DISPATCH_TOKEN`. No hostnames, SSH, or
provider details (real deploy logic lives in `minutia-ops`). Boundary-clean. Secrets are user-managed.

## Testing (TDD, real functionality only)

- **Contract verifiers** (`node:test`, run in CI lint job): `verify-reminders.test.mjs`
  (gather grouping, cascade resolution, branding present in every channel payload, webhook/slack
  shape), `verify-admin-health.test.mjs` (status mapping). Failing-first.
- **E2E** (Playwright, real UI + flow): reminders button visible to facilitators, dialog opens,
  clipboard channel copies a payload containing issue titles + "Sent via Minutia"; admin link
  visible only to admin, `/admin` guarded (non-admin redirected), config edit persists, users page
  lists members, health page renders service rows. Each test asserts real on-screen content, not
  presence of an empty element.
- Full `pnpm test:e2e` (16 shards) is the merge gate. Two independent review passes per surface.

## Decisions (auto-resolved, recommended)

- Reminder default channel = cascade resolution above; user can't misconfigure (zero-config
  clipboard always works on self-host).
- Reminders operate at **series** scope (nudge each owner about their open issues in that series);
  meeting-detail button reuses the same series-scoped action.
- Admin is a **new `/admin` route group**, not more `/settings` tabs (cleaner, avoids clutter);
  member management **moves** there with a link left behind in settings (no duplication).
- Branding line is non-removable in OSS (it is open-source attribution, not strategy disclosure).
