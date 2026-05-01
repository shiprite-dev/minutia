# Contributing to Minutia

Thank you for your interest in contributing to Minutia. This guide covers everything you need to get started.

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker (for local Supabase database)
- Supabase CLI (optional, for migration management)

## Development Setup

```bash
git clone https://github.com/shiprite-dev/minutia.git
cd minutia
cp .env.example .env.local
# Fill in your Supabase keys in .env.local
pnpm install
pnpm dev
```

For the database, either run Supabase locally (`npx supabase start`) or use `docker compose up supabase-db` to start just the Postgres instance. Migrations in `supabase/migrations/` are applied automatically.

## Project Structure

```
src/
  app/(app)/      # Authenticated routes (App Router)
  app/(auth)/     # Login page
  app/share/      # Public guest share pages
  components/
    minutia/      # App-specific components
    ui/           # shadcn/ui primitives
  lib/
    supabase/     # Client, server, auth actions
    hooks/        # React Query hooks
    stores/       # Zustand stores
    types.ts      # Shared TypeScript types
    schemas.ts    # Zod validation schemas
supabase/
  migrations/     # Numbered SQL migrations
e2e/
  regression/     # Playwright E2E tests
```

## Coding Standards

- **TypeScript strict mode** for all files
- **Server components by default**; add `"use client"` only when needed
- **Tailwind CSS v4** for styling; no raw hex colors, use design tokens
- **Motion** (not framer-motion) for animations
- **Zod** for all form and API validation
- **React Query** for server state, **Zustand** for UI state
- No comments unless the "why" is non-obvious

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(oil-board): add drag-to-reorder support
fix(auth): handle expired session redirect loop
chore(deps): update Motion to v12
docs: update self-hosting guide
```

Scopes: `oil-board`, `series`, `meetings`, `issues`, `auth`, `share`, `settings`, `deps`, `ci`, `e2e`

## Pull Request Process

1. Branch from `main` with a descriptive name (`feat/drag-reorder`, `fix/session-redirect`)
2. Make your changes
3. Run the full check suite:
   ```bash
   pnpm lint
   pnpm build
   pnpm test:e2e
   ```
4. Open a PR with a clear summary of **what** changed and **why**
5. If your PR includes user-facing changes, update `CHANGELOG.md`
6. CI must pass before merge

## Issue Reporting

- **Bugs**: Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include steps to reproduce, expected vs. actual behavior, and your environment.
- **Features**: Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml). Describe the problem, your proposed solution, and alternatives considered.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold its standards.
