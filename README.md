# Minutia

**Stop losing track of what was said, decided, and owed in your meetings.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL_3.0-blue.svg)](LICENSE)
[![CI](https://github.com/shiprite-dev/minutia/actions/workflows/ci.yml/badge.svg)](https://github.com/shiprite-dev/minutia/actions/workflows/ci.yml)

![Minutia OIL Board](public/screenshots/oil-board-hero.png)

---

## The Problem

Every recurring meeting (vendor syncs, steering committees, project standups, 1:1s) generates action items, decisions, and follow-ups. These end up in spreadsheets that nobody updates, email chains that get buried, or Notion databases that break when someone edits a relation.

You spend 30 minutes before every sync rebuilding the same agenda from memory. Issues slip through. People forget what they owe. The spreadsheet rots.

## The Fix

Minutia is a purpose-built **Outstanding Issues Log (OIL)** for recurring meetings. Issues persist across meetings. Status is tracked with accountability. You walk into every meeting knowing exactly what's pending, who owes what, and since when.

- **Free and open source** (AGPL-3.0). Self-host it on your own infrastructure, forever.
- **AI-optional, human-first.** Works without any AI, recording, or calendar integration. Turn on AI features when you're ready.
- **Built for mixed teams.** Tech leads, vendors, coordinators, non-technical stakeholders. Anyone can use it in 10 seconds via a share link, no account needed.

## What You Get

### OIL Board

Your outstanding issues dashboard. Filter, sort, group by series/owner/priority. Keyboard-navigable (J/K to move, S to cycle status, N to add).

![OIL Board - Dark Mode](public/screenshots/oil-board-dark.png)

### Meeting Series & Pre-Meeting Briefs

Recurring meetings with cadence, attendees, and automatic pre-meeting briefs. See what's pending before your meeting, send a one-click summary to attendees.

![Series Detail with Brief](public/screenshots/series-detail.png)

### Meeting Complete & Inline Tasks

After a meeting ends, see a summary of raised items, decisions, and carried-forward issues. Items render as interactive checklists with colored category pills (Action, Blocker, Decision, Info, Risk) and assignee avatars.

![Meeting Complete](public/screenshots/meeting-detail.png)

### AI Meeting Notes & Auto Action Items (opt-in)

Record meeting audio in the browser; Minutia transcribes it and extracts accountable action items for you to review. Unlike a one-off summarizer, the extraction reasons over the **entire series history**: it deduplicates against open OIL items, flags when a meeting resolves or advances an existing item (a status update straight onto the board), and warns about duplicates, so your log stays clean. Nothing enters the permanent record until a facilitator approves it. Bring your own AI key; everything else works without it.

### Issue Lifecycle

Every issue has a full timeline: when it was raised, every status change, every update, across every meeting it was discussed in.

![Issue Detail with Lifecycle](public/screenshots/issue-detail.png)

### My Actions

See everything you owe across all your meeting series, prioritized by urgency.

![My Actions](public/screenshots/my-actions.png)

### Settings & Integrations

Connect Google Calendar for read-only calendar sync, manage your profile, choose light/dark/system theme, and export all your data as CSV or JSON.

![Settings](public/screenshots/settings.png)

### And more

- **Live Capture** - Raise issues in real-time with type prefixes (`a ` for action, `d ` for decision, `r ` for risk). Carried items from last meeting pre-populated. Works offline with auto-sync.
- **Calendar Sidebar** - Persistent mini-calendar panel (Ctrl+.), month navigation, day agenda with meeting links, scroll-to-date integration on series timeline.
- **Google Sign-In** - One-click OAuth login alongside email/password and guest auth.
- **Guest Sharing** - Share read-only links with external collaborators. No account required.
- **Single-Workspace Team Access** - Self-hosted instances use one workspace with admin-managed invitations for teammates.
- **One-Click Reminders** - Nudge issue owners about their open items between meetings, via email, Slack, webhook, or a copy-paste digest.
- **Admin / Instance Panel** - Operator console for self-hosted instances: overview metrics, runtime config (SMTP, feature flags, AI keys), user management, and service-health checks.
- **Command Palette** - Cmd+K to search across all issues and series instantly.
- **CSV Import/Export** - Migrate from your spreadsheet in seconds. Export anytime.
- **Draggable Widgets** - Drag-to-reorder and resize dashboard widgets. Layout persists via localStorage.
- **Dark Mode** - Both modes are first-class, not afterthoughts.
- **Self-hostable** - One-command Docker Compose deployment.

## Get Started in 60 Seconds

### Self-Hosted (free forever)

Requires **Docker and Docker Compose v2** (Docker Desktop 4.x, or Docker Engine 24+ with the Compose plugin).

```bash
git clone https://github.com/shiprite-dev/minutia.git
cd minutia
pnpm deploy:env          # or: node scripts/generate-self-host-env.mjs
docker compose up -d
```

`deploy:env` writes a `.env` with freshly generated secrets and a one-time setup token. It runs on Node or pnpm; if you have neither, generate it with Docker instead:

```bash
docker run --rm -v "$PWD":/app -w /app node:22-alpine node scripts/generate-self-host-env.mjs
```

`docker compose up -d` builds and serves the production app (`node server.js`). The first run also applies the full database schema before the app starts serving, so on a fresh box give it a minute. Watch progress with `docker compose logs -f supabase-migrate`; it exits when the database is ready.

Open [http://localhost:3000/setup](http://localhost:3000/setup). Enter the `MINUTIA_SETUP_TOKEN` written to `.env`, create the first admin account, optionally seed demo data, then sign in.

For a real domain, generate env with explicit public URLs: `pnpm deploy:env -- --site-url https://minutia.example.com --api-url https://api.example.com`. By default the app and API gateway bind to `127.0.0.1` (nothing is exposed to the network); to serve a domain, run a TLS-terminating reverse proxy in front of the app and set `WEB_BIND` and `KONG_BIND` to `0.0.0.0` in `.env` so the proxy can reach the containers.

Self-hosted Minutia uses one workspace per instance. The first admin manages that workspace and invites additional users from Settings. Public signup is disabled by default; if you explicitly enable it, new users join the existing workspace as members.

**Back up your data.** Everything lives in two named Docker volumes: `minutia-db-data` (Postgres) and `minutia-storage-data` (uploaded audio). Snapshot the database anytime with:

```bash
docker compose exec -T supabase-db pg_dump -U postgres minutia > minutia-backup.sql
```

**Restore from a backup.** The dump above is plain SQL, so restore it with `psql`. Restore into an empty database (stop the app and recreate the `minutia-db-data` volume, or point at a fresh box) so the load does not collide with existing rows:

```bash
docker compose up -d supabase-db
cat minutia-backup.sql | docker compose exec -T supabase-db psql -U postgres -d minutia
docker compose up -d
```

### Upgrading

Back up first (see above), then pull the new release and rebuild:

```bash
git pull
docker compose up -d --build
```

The `supabase-migrate` service applies any new database migrations before the app starts serving, so schema changes land automatically. Watch it with `docker compose logs -f supabase-migrate`; it exits when the database is ready. Your data in `minutia-db-data` and `minutia-storage-data` is preserved across the rebuild.

### Development

```bash
git clone https://github.com/shiprite-dev/minutia.git
cd minutia
pnpm install
cp .env.example .env.local

# Start local Supabase (requires Docker)
npx supabase start

# Start dev server
pnpm dev
```

Prefer to run everything in Docker with hot reload? Load the opt-in dev overlay on top of the production stack (it swaps the web container to the Next.js dev server with a source mount and exposes Postgres on the host):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

For local development, visit `/setup` first when `instance_config.setup_completed` is false. In production, setup is protected by `MINUTIA_SETUP_TOKEN`.

### Onboarding

Minutia has two onboarding layers:

- **Instance setup** is one-time. `/setup` checks environment health, creates the first admin, saves optional instance settings, optionally seeds demo data, and stores completion in `instance_config.setup_completed`.
- **User onboarding** is per user. Any signed-in user with `profiles.has_completed_onboarding = false` sees the three-step onboarding wizard: confirm display name, optionally create a first meeting series, then review a quick product tour. Completing or skipping it updates only that user's profile.

The current tour is a lightweight checklist inside onboarding, not a persistent guided overlay. Keyboard shortcuts remain available from `?` after onboarding.

### Troubleshooting

- **`/setup` reports a database error on a fresh install** - the schema is still being applied. Watch the one-time migration step with `docker compose logs -f supabase-migrate` (it exits when done), then reload.
- **Port already in use** - another process holds `3000` or `8000`. Set `WEB_PORT` / `KONG_HTTP_PORT` in `.env` and re-run `docker compose up -d`.
- **App loads but new accounts can't sign in** - email is optional; without SMTP configured, set `ENABLE_EMAIL_AUTOCONFIRM=true` in `.env` so accounts are confirmed without an email round-trip.

## Who Is This For?

- **Project coordinators** running vendor syncs, steering committees, ops/eng standups
- **Tech leads** tracking cross-team action items across recurring meetings
- **Anyone** who currently uses a spreadsheet to track meeting follow-ups and is tired of it rotting

**Not for**: engineering teams that live in Jira/Linear (you already have sprint tracking), board-level governance with regulatory requirements (use BoardPro/Diligent), or teams that want AI to replace human note-taking entirely.

## How It Compares

| | Minutia | Fellow | Notion | Excel/Sheets |
|---|---------|--------|--------|-------------|
| Purpose-built OIL | Yes | Feature inside meeting tool | DIY database | Manual rows |
| Open source | AGPL-3.0 | No | No | N/A |
| Self-hostable | Yes | No | No | N/A |
| AI required | No (opt-in) | Yes (core dependency) | No | No |
| Calendar required | No | Yes | No | No |
| Cross-meeting continuity | Core feature | Carry-forward | Manual linking | Manual copy-paste |
| Price | Free (self-host) | $7-25/seat/mo | Free-$10/seat | Free |

## AI (opt-in)

Minutia works with zero AI, recording, or calendar; the data model is AI-ready and every AI feature is opt-in.

- **Meeting transcription** - browser audio capture, auto-transcribed with Whisper (via Groq or any OpenAI-compatible provider). Recordings upload in segments during the meeting for fast transcription and crash resilience. By default the raw audio is discarded once transcription completes and only the transcript is kept; an admin can change this to keep audio forever in Admin > Settings > Recording.
- **Context-aware action items** - extraction that reasons over the full series history to deduplicate, detect resolutions, and flag duplicates, rather than summarizing one meeting in isolation.
- **Note enhancement and carryover briefings** - clean up freeform notes and surface what carries into the next meeting.

Self-hosters bring their own key: set `OPENROUTER_API_KEY` (or an OpenAI-compatible key) in your environment to enable AI, or leave it unset to run fully AI-free.

### Speaker diarization

Speaker labels ("who said what") need a diarizing transcription provider. Groq and OpenAI-compatible Whisper transcribe accurately but return unlabeled text; only two providers diarize:

- **AssemblyAI** - set `ASSEMBLYAI_API_KEY` and `TRANSCRIPTION_PROVIDER=assemblyai`.
- **Local WhisperX sidecar** - run the sidecar and point `TRANSCRIPTION_LOCAL_URL` at it, with `TRANSCRIPTION_PROVIDER=local`, to keep audio on your own infrastructure.

With neither configured, transcripts are produced without speaker labels. Admin > Health shows the current transcription mode ("diarization on" or "transcription only").

## Capture the meeting, no bot in the room

Some conversations you want captured word for word. [Minutia Desktop](https://github.com/shiprite-dev/minutia-desktop) is a native macOS menu bar app that records the meeting the moment it starts, your microphone and the room's system audio both, whether you're on Zoom, Teams, Meet, or sitting across a table. Nothing joins the call: no recording bot in the participant list, no extra service in the middle of your conversation.

It notices when a call begins and offers to record with a single click. Audio uploads while you're still talking, so your recap is already writing itself seconds after you say goodbye, and the commitments people made land straight in your Outstanding Issues Log, each with an owner and a due date.

Pairing takes one click from the browser: no separate account, no password to type into yet another app. And because you self-host, the recording never leaves your infrastructure. It's discarded the instant it's transcribed, unless you choose to keep it.

**[Get Minutia Desktop](https://github.com/shiprite-dev/minutia-desktop)** (macOS, free and open source)

## Roadmap

### Planned
- Scheduled email digests and pre-meeting nudges (Resend + SMTP)
- `/api/v1/ingest` REST endpoint for transcript ingestion
- Drag-to-reorder issue priority
- PDF export
- Enterprise SSO (SAML / OIDC)

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` | New issue (quick add) |
| `J` / `K` | Navigate issues on OIL Board |
| `S` | Cycle issue status |
| `C` | Add update/comment |
| `Cmd+K` | Command palette |
| `Ctrl+.` | Toggle calendar sidebar |
| `?` | Show all shortcuts |

---

## Technical Details

### Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, React 19, Turbopack) |
| Styling | Tailwind CSS v4 + OKLCH color system |
| Components | shadcn/ui (Radix primitives) |
| Database | Postgres via Supabase (RLS on every table) |
| Auth | Supabase Auth (email/password, Google OAuth) |
| State | TanStack React Query + Zustand |
| Animation | Motion v12 |
| Testing | Playwright (120+ E2E tests) |

### Project Structure

```
src/
  app/(app)/        Authenticated routes (OIL Board, Series, Issues, Settings)
  app/(auth)/       Login page
  app/share/        Public guest share pages (no auth)
  components/       UI primitives (shadcn) + app components (minutia/)
  lib/              Hooks, stores, types, schemas, offline buffer
supabase/
  migrations/       Numbered SQL migrations
e2e/
  regression/       Playwright test specs
docker-compose.yml  One-command self-hosting
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (localhost:3000) |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm test:e2e:ui` | Playwright UI mode |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and PR process.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[AGPL-3.0](LICENSE). Self-host free forever. Your data is yours.

---

Built by [ShipRite](https://shiprite.dev). Star the repo if Minutia replaces your meeting spreadsheet.
