# Minutia

Meeting issue tracker: raise, track, and resolve issues across recurring meeting series.

## Stack

- **Framework**: Next.js 16 (App Router, `use client` components)
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **Backend**: Supabase (Postgres, Auth, RLS)
- **State**: TanStack React Query for server state, Zustand for UI state
- **Animation**: Motion (formerly Framer Motion)
- **Package manager**: pnpm
- **Testing**: Playwright (E2E regression suite)

## Project Structure

```
src/
  app/
    (app)/          # Authenticated routes (layout with sidebar)
      page.tsx      # OIL Board dashboard (outstanding items)
      actions/      # My Actions page
      inbox/        # Notifications inbox
      issues/[id]/  # Issue detail
      series/       # Series list + [id]/ detail with meetings/[meetingId]
      settings/     # User settings
    (auth)/         # Login page
    share/[token]/  # Public guest share pages (unauthenticated)
  components/
    minutia/        # App-specific components
    ui/             # shadcn/ui primitives
  lib/
    supabase/       # Client, server, auth actions
    hooks/          # React Query hooks (use-issues, use-series, etc.)
    stores/         # Zustand stores (ui-store)
    types.ts        # Shared TypeScript types
    schemas.ts      # Zod validation schemas
    constants.ts    # App constants
    export.ts       # CSV export utility
supabase/
  migrations/       # Numbered SQL migrations (00001-00004)
e2e/
  regression/       # 12 spec files, ~94 tests
  auth.setup.ts     # Playwright auth setup project
```

## Commands

```bash
pnpm dev              # Start dev server (localhost:3000)
pnpm build            # Production build
pnpm lint             # ESLint
pnpm test:e2e         # Run Playwright regression suite
pnpm test:e2e:headed  # Run with browser visible
pnpm test:e2e:ui      # Playwright UI mode
```

## Database Migrations

Migrations in `supabase/migrations/` are numbered sequentially:
- `00001_initial_schema.sql` - Core tables: profiles, meeting_series, meetings, issues, decisions, issue_updates
- `00002_nullable_update_meeting.sql` - Makes issue_updates.meeting_id nullable
- `00003_notifications.sql` - Notifications table
- `00004_anon_share_access.sql` - RLS SELECT policies for anonymous guest share access

## E2E Test Suite

Tests live in `e2e/regression/` with shared seed data in `seed-data.ts`. Auth is handled by a setup project that stores credentials in `e2e/.auth/user.json`.

Key patterns:
- Use `.first()` on locators that may match multiple elements (e.g., issues created by prior test runs)
- CardTitle renders as `<div data-slot="card-title">`, not a heading role
- StatusChip uses `role="combobox"` when interactive (has onChange)
- Use `{ exact: true }` when radio/button names are substrings of others (e.g., "Weekly" vs "Biweekly")
- Share tests use `storageState: { cookies: [], origins: [] }` for unauthenticated access
- Queries with ambiguous FKs need explicit hint: `issues!issues_raised_in_meeting_id_fkey(*)`

## What Has Been Done

### Core Features (Complete)
- **OIL Board Dashboard**: Hero card with open/pending/overdue counts, outstanding items grouped by series, filter pills (All/Open/Pending/Overdue), age-of-open-items card, next meeting card, your series card
- **Series Management**: Create/edit series, series detail with meeting history, open issues, settings dialog (cadence, attendees), brief card for pre-meeting prep
- **Meeting Flow**: Start meetings from series, meeting detail with agenda/notes/decisions, meeting timeline, completed vs upcoming states
- **Issue Lifecycle**: Full CRUD, inline title/description editing, status transitions (Open/In Progress/Pending/Resolved/Dropped), priority levels, category types (Action/Blocker/Risk/Decision/Info), lifecycle timeline with updates, keyboard shortcuts (S=cycle status, C=add update, Escape=back)
- **Guest Sharing**: Share meetings and series via token links, public pages with no auth required, RLS policies for anonymous access
- **Notifications/Inbox**: Notification list with read/unread state, mark all read, grouped by time
- **My Actions**: Personal action items with needs-attention/pending/completed sections
- **Settings**: Profile editing, theme switching, data export (CSV)
- **Quick Add**: FAB + N keyboard shortcut, series/meeting selection, creates issue inline
- **Keyboard Navigation**: J/K to move focus on OIL board, N for quick-add, shortcuts suppressed in inputs
- **Brief Card**: Pre-meeting brief generation, copy to clipboard, conditional mailto when attendees have email addresses, visual confirmation feedback
- **Command Palette**: Cmd+K search across issues and series
- **CSV Import**: Bulk import issues from CSV

### Infrastructure (Complete)
- Supabase auth with email/password
- Row-Level Security on all tables
- React Query for data fetching with optimistic updates
- Zustand UI store for sidebar state, modals
- Motion animations throughout
- Mobile responsive layouts
- 94 Playwright E2E regression tests across 12 files

## What Remains

### Phase 1 (MVP Polish)
- Mobile responsive polish (minor layout tweaks on small screens)
- Error boundaries and loading states audit
- Accessibility audit (keyboard navigation completeness, screen reader labels)

### Phase 2 (Post-MVP)
- Google Calendar integration (sync meeting series with calendar events)
- AI-powered meeting summarization
- Real-time collaboration (Supabase Realtime subscriptions)
- Team/org management (multi-user beyond single profile)
- Email notifications (beyond in-app inbox)
- Recurring issue templates
- Analytics dashboard (trends over time, resolution rates)
