# Hermetic authz gate harness

Runs minutia's REAL middleware, server-layout guards, and route-handler guards headlessly
in Node against a fixture `fetch` — no dev server, no database, no network. It crawls the
whole-app authorization matrix (every policy node × every identity) and asserts (a) the
crawl was hermetic (zero requests escaped the fixture grammar) and (b) the observed matrix
satisfies the hand-audited `policy.json` exactly.

**Seam**: `globalThis.fetch` is swapped before the bundled modules run. Every minutia
Supabase client resolves global fetch per call, so one swap covers the browser / server /
service-role / middleware clients at once.

**Hermeticity rule**: assert the fixture's unmatched-request log is empty on positive
probes. postgrest-js / auth-js swallow a thrown fetch error into a null-data result instead
of rejecting, so a thrown `UnmatchedRequestError` does NOT propagate to the caller — you
cannot rely on rejection to prove every request was fixtured. Hence the unmatched log, plus
the real-code negative controls (`negcontrol.mjs`) that flip the gate red on a real defect.

## Module map

- `bundle.mjs` — esbuild setup, next/headers + next/navigation shims, `bundleMiddleware()`,
  `bundleServerComponent()`. Bundles real Next route guards to a temp dir, imports them as ESM.
- `identity.mjs` — JWT / storage-cookie minting, `COOKIE_NAME` derivation (matches the app).
- `env.mjs` — side-effect module setting the fixture Supabase env; imported FIRST everywhere
  so `COOKIE_NAME` derives to `sb-fixture-auth-token` before any bundle loads.
- `fixture.mjs` — the bounded PostgREST + GoTrue emulator (the fetch seam). Serves GoTrue user
  validation + scoped REST reads; anything outside that grammar (write, RPC, undeclared table,
  unknown path) is logged to `unmatched` and thrown as `UnmatchedRequestError`.
- `scenarios.mjs` — the fixed principals (member, org-admin, global-admin, cross-tenant, pro),
  the table rows the fixture serves, and the process env. All UUIDs fixed so `policy.json` and
  probe assertions reference concrete ids. `baseScenario` + `makeScenario(overrides)`.
- `nodes.mjs` — the probe `manifest` (each policy node → a concrete probe target) and
  `deferredRoutes` (on-disk routes NOT executed, each with a reason). Asserts manifest ids ==
  policy node ids at import.
- `probe.mjs` — the probe atom: runs one (node, identity) pair through the real bundled guard
  and normalizes the result to a plain verdict (`pass | redirect:/x | 401 | 403 | error:*`).
- `crawl.mjs` — bundles each target once, runs the full (node × identity) matrix against a
  fresh fixture, returns the matrix + aggregate (hermeticity gaps + an AKG-shaped artifact).
- `policy.mjs` — the PURE checker: compares the observed matrix against `policy.json` and
  returns a flat violation list. Default-deny; also flags tenant leaks and vacuous
  tenant-scoped passes (`tenant-unverified`).
- `policy.json` — the hand-audited authz TRUTH (expected outcome per node × identity), audited
  against `src/middleware.ts` + the server-component guards + the API handler guards.
- `run-crawl-once.mjs` — fresh-process crawl entry that prints violations as JSON; spawned by
  `negcontrol.mjs` (bundling caches per process, so observing a source edit needs a new one).
- `negcontrol.mjs` — REAL-CODE negative controls: transiently mutates real minutia source (the
  admin role guard; the workspace tenant filter), asserts the gate goes red with the expected
  violation, then ALWAYS restores. The proof the gate cannot lie.
- `verify-authz.test.mjs` — THE GATE: runs the crawl, asserts hermetic + policy-clean, emits
  the AKG artifact, plus three synthetic negative controls proving the checker isn't vacuous.
- `coverage.test.mjs` — the filesystem coverage gate: every `page.tsx` / `api/**/route.ts` on
  disk is either executed in `manifest` or listed in `deferredRoutes`; and no `deferredRoutes`
  key is stale. A new unguarded route in neither fails here.
- `fixture.test.mjs` / `smoke-bundle.test.mjs` — unit + smoke tests for the fixture grammar and
  the bundling / identity plumbing.

## Covered / Not covered

COVERED (server-side authorization, proven by real code executing through the fixture):
- Middleware reachability for every page route (public vs authed-redirect, per identity).
- The admin server-layout role guard (`(app)/admin/layout.tsx`): only global-admin passes.
- API handler authz status across all guard families, via executed representatives
  (`requireAdmin`, `requireCurrentOrgAdmin`, `getUser`-401, public) plus the two tenant-scoped
  list handlers (`workspace/members`, `admin/invitations`).
- Cross-tenant isolation on the tenant-scoped handlers (a caller sees ONLY its org's rows;
  an all-empty pass is flagged), proven by real-code mutation in `negcontrol.mjs`.
- The coverage gate: every on-disk route is either executed in the matrix or in
  `deferredRoutes` with a reason — a new route can't slip in unclassified.

NOT COVERED (deferred to Playwright + real-DB E2E):
- Client-component rendering (the `(app)/admin/*` shells; anything below the guard).
- Real RLS SQL enforcement — the fixture applies URL filters literally, with NO RLS emulation;
  it proves the app-code tenant scoping, not the database's.
- Write / PUT / PATCH / DELETE + RPC business logic (all non-GET handlers).
- External integrations (Google OAuth / calendar, AI, email, billing) and token/webhook flows.
