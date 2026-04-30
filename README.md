# Minutia

**The open-source Outstanding Issues Log for recurring meetings.**

Track outstanding issues, decisions, and action items across meeting series. Keep your team aligned without the overhead.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL_3.0-blue.svg)](LICENSE)
[![CI](https://github.com/minutia-app/minutia/actions/workflows/ci.yml/badge.svg)](https://github.com/minutia-app/minutia/actions/workflows/ci.yml)

## Features

- **OIL Board**: Outstanding Issues Log dashboard with filtering, grouping, and keyboard navigation (J/K)
- **Meeting series**: Recurring meetings with cadence, attendees, and pre-meeting briefs
- **Issue lifecycle**: Open, In Progress, Pending, Resolved, Dropped with full audit timeline
- **Live capture**: Raise issues during meetings with real-time capture mode
- **Guest sharing**: Share meetings and series via token links (no login required)
- **Command palette**: Cmd+K to search across issues and series
- **CSV import/export**: Bulk import and export your data
- **Keyboard-first**: Shortcuts for every action (N to add, S to cycle status, C to comment)
- **Dark mode**: System-aware theme with light, dark, and auto modes
- **Self-hostable**: Docker Compose setup, bring your own Supabase

## Quick Start (Self-Hosted)

```bash
git clone https://github.com/minutia-app/minutia.git
cd minutia
cp .env.example .env
docker compose up
```

Open [http://localhost:3000](http://localhost:3000).

## Quick Start (Development)

```bash
git clone https://github.com/minutia-app/minutia.git
cd minutia
cp .env.example .env.local
pnpm install

# Start local Supabase (requires Docker)
npx supabase start

# Start the dev server
pnpm dev
```

## Tech Stack

Next.js 16 (App Router), Tailwind CSS v4, shadcn/ui, Supabase (Postgres + Auth + RLS), TanStack React Query, Zustand, Motion, Playwright

## Project Structure

```
src/app/(app)/     Authenticated routes (OIL Board, Series, Issues, Settings)
src/app/(auth)/    Login page
src/app/share/     Public guest share pages
src/components/    UI primitives (shadcn) and app components
src/lib/           Hooks, stores, types, utils
supabase/          Database migrations
e2e/               Playwright E2E tests (135 tests)
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm test:e2e:ui` | Playwright UI mode |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and PR process.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[AGPL-3.0](LICENSE)
