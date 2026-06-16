# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Minutia Retro: a free, anonymous, multiplayer retrospective board at `/retro`. Guided 7-phase ritual (Lobby, Reflect, Reveal, Theme, Vote, Discuss, Commit) with realtime presence, a synchronized card-flip Reveal, and a closure bloom. Boards are ephemeral (30-day auto-expiry) and rate-limited.
- Anonymous board operations run through `SECURITY DEFINER` Postgres RPCs (default-deny `retro_*` tables); liveness uses Supabase Realtime broadcast and presence with a snapshot reconcile.
- AI theme-clustering suggestions during the Theme phase (OpenRouter; degrades silently when unconfigured).
- Graduation: account-gated "Save to Minutia" turns retro action items into tracked issues in a new or existing series; free Markdown export needs no account.
- `retro_enabled` instance flag (default off; admin toggle in workspace settings) gates the public board surface for self-host instances.

## [0.1.0] - 2026-04-30

### Added

- OIL Board dashboard with hero card, outstanding items grouped by series, filter pills, and keyboard navigation (J/K)
- Series management: create, edit, settings dialog (cadence, attendees), brief card for pre-meeting prep
- Meeting flow: start meetings from series, meeting detail with agenda, notes, decisions, and timeline
- Issue lifecycle: full CRUD, inline editing, status transitions (Open/In Progress/Pending/Resolved/Dropped), priority levels, category types (Action/Blocker/Risk/Decision/Info), lifecycle timeline
- Guest sharing via token links with public pages (no auth required)
- Notifications inbox with read/unread state and mark-all-read
- My Actions page with needs-attention, pending, and completed sections
- Settings page with profile editing, theme switching, and CSV data export
- CSV import for bulk issue creation
- Quick Add FAB with N keyboard shortcut
- Command palette (Cmd+K) for searching issues and series
- Brief card with copy-to-clipboard and mailto integration
- Skeleton loading screens for all route segments
- Error boundaries for all route segments
- Reduced motion support (prefers-reduced-motion)
- Card stagger animations, status change dimming, timeline animations, button micro-interactions, dialog spring-in
- Post-meeting summary card with copy-to-clipboard
- Dark mode with system preference detection
- Supabase auth with email/password
- Row-Level Security on all tables
- Docker Compose for self-hosting
- 135 Playwright E2E regression tests
