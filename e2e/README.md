# E2E Tests

Powered by [Playwright](https://playwright.dev/).

## Quick Start

```bash
# 1. Start Supabase (first time only)
supabase start

# 2. Copy the anon key from the output into .env.local

# 3. Reset the database to apply seeds (creates test@example.com user)
supabase db reset

# 4. Run all tests (setup runs first, then the test suite)
pnpm test:e2e
```

## Running Tests

```bash
# Run all tests
pnpm test:e2e

# Run in headed mode (see the browser)
pnpm test:e2e --headed

# Run specific test file
pnpm test:e2e e2e/auth.spec.ts

# Run with UI mode
pnpm test:e2e --ui

# Debug a test
pnpm test:e2e --debug
```

## Test Structure

| File | Purpose |
|------|---------|
| `auth.spec.ts` | Authentication flows (login, magic link, OAuth) |
| `navigation.spec.ts` | Sidebar navigation between pages |
| `oil-board.spec.ts` | OIL Board functionality (filters, quick add, shortcuts) |
| `series.spec.ts` | Series and meeting detail pages |
| `settings.spec.ts` | Settings page |
| `smoke.spec.ts` | Critical path smoke tests |

## Auth Setup

Authenticated tests require a logged-in session. The `e2e/setup/auth.setup.ts` file handles this automatically:

1. Calls the Supabase Auth API directly to sign in `test@example.com`
2. Sets the auth cookie in the browser context
3. Saves `e2e/.auth/user.json` for reuse across test files

The setup project runs before the main `chromium` project (see `playwright.config.ts`).

### How the test user is created

The test user is seeded via `supabase/seed.sql`:

- **Email:** `test@example.com`
- **Password:** `password123`
- **Name:** Test User (via `raw_user_meta_data`)

The `on_auth_user_created` trigger automatically creates the matching `profiles` row.

### Manual auth (if needed)

If you need to regenerate the auth state file manually:

```bash
npx playwright test e2e/setup/auth.setup.ts
```

## Configuration

See `playwright.config.ts` at the project root.
