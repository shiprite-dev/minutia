// SPIKE: prove minutia's real route guards (middleware + admin server-layout)
// can be exercised headlessly in Node with a fixture fetch — no dev server, no
// database, no network. Seam = globalThis.fetch swapped before the bundled
// modules run; every minutia Supabase client resolves global fetch per call, so
// one swap covers browser/server/service-role/middleware clients at once.
//
// Run: node --test scripts/verify-authz-spike.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// ---------------------------------------------------------------------------
// Env — set BEFORE importing any bundled module. Hostname 'fixture' derives the
// Supabase cookie name to sb-fixture-auth-token (see src/lib/supabase/auth-cookie.ts).
// ---------------------------------------------------------------------------
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fixture.supabase.local:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-fixture-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-fixture-key";
delete process.env.SUPABASE_INTERNAL_URL;
delete process.env.NODE_ENV; // dev rate-limit budgets, avoids 429 flakiness

const SUPA_ORIGIN = "http://fixture.supabase.local:54321";
const COOKIE_NAME = "sb-fixture-auth-token";

const MEMBER_UUID = "11111111-1111-4111-8111-111111111111";
const ADMIN_UUID = "22222222-2222-4222-8222-222222222222";
const MEMBER_EMAIL = "member@fixture.local";
const ADMIN_EMAIL = "admin@fixture.local";

const root = process.cwd();

// ---------------------------------------------------------------------------
// esbuild: bundle the two REAL guard entry points. platform node, esm, bundle,
// absWorkingDir = repo root so tsconfig `paths` (@/ -> src/) resolve. Asset
// loaders map non-JS imports to empty so bundling can't break on CSS/fonts.
// Virtual shims for next/headers + next/navigation only; next/server stays REAL.
// ---------------------------------------------------------------------------
const shimPlugin = {
  name: "next-shims",
  setup(build) {
    build.onResolve({ filter: /^next\/(headers|navigation)$/ }, (a) => ({
      path: a.path,
      namespace: "next-shim",
    }));
    build.onLoad({ filter: /.*/, namespace: "next-shim" }, (a) => {
      if (a.path === "next/headers") {
        return {
          loader: "js",
          contents: `
            export async function cookies() {
              const ctx = globalThis.__ADMIN_PROBE__ || { cookies: [], headers: {} };
              const jar = ctx.cookies || [];
              return {
                getAll() { return jar.map((c) => ({ name: c.name, value: c.value })); },
                get(name) { const f = jar.find((c) => c.name === name); return f ? { name: f.name, value: f.value } : undefined; },
                set() {},
              };
            }
            export async function headers() {
              const ctx = globalThis.__ADMIN_PROBE__ || { cookies: [], headers: {} };
              const h = ctx.headers || {};
              return { get(name) { const v = h[String(name).toLowerCase()]; return v == null ? null : v; } };
            }
          `,
        };
      }
      return {
        loader: "js",
        contents: `
          export function redirect(url) {
            throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;" + url + ";307;" });
          }
          export function notFound() {
            throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
          }
          export function usePathname() { throw new Error("usePathname stub"); }
          export function useRouter() { throw new Error("useRouter stub"); }
          export function useSearchParams() { throw new Error("useSearchParams stub"); }
        `,
      };
    });
  },
};

const buildOpts = {
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  jsx: "automatic",
  // next/server is bundled REAL, but some of its transitive CJS deps (ua-parser)
  // reference __dirname/require at module scope. An ESM bundle has neither, so
  // provide them via a banner backed by createRequire(import.meta.url).
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'module';",
      "import { fileURLToPath as __fileURLToPath } from 'url';",
      "import { dirname as __pathDirname } from 'path';",
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join("\n"),
  },
  loader: { ".css": "empty", ".svg": "empty", ".png": "empty", ".jpg": "empty", ".woff2": "empty" },
  plugins: [shimPlugin],
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-authz-spike-"));
const mwOut = path.join(tempDir, "middleware.mjs");
const adminOut = path.join(tempDir, "admin-layout.mjs");

// Wrapper entry: bundle the REAL middleware and re-export NextRequest from the
// same graph, so next/server is bundled exactly once and the NextRequest we
// construct is the same class the middleware reads (no two-copy skew). Bare
// `import "next/server"` is not resolvable under plain Node ESM (next's export
// conditions), which is why we go through esbuild here.
await esbuild.build({
  ...buildOpts,
  stdin: {
    contents:
      `export { middleware, config } from ${JSON.stringify(path.join(root, "src/middleware.ts"))};\n` +
      `export { NextRequest, NextResponse } from "next/server";`,
    resolveDir: root,
    loader: "ts",
  },
  outfile: mwOut,
});
await esbuild.build({ ...buildOpts, entryPoints: ["src/app/(app)/admin/layout.tsx"], outfile: adminOut });

const { middleware, NextRequest } = await import(pathToFileURL(mwOut).href);
const { default: AdminLayout } = await import(pathToFileURL(adminOut).href);

// ---------------------------------------------------------------------------
// Fixture fetch — the single seam. Matches by pathname+query; any unmatched
// request THROWS UnmatchedRequestError (hermetic guard: never silently 404).
// ---------------------------------------------------------------------------
class UnmatchedRequestError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "UnmatchedRequestError";
  }
}

const requestLog = [];
const thrownLog = [];
let setupValue = "true";
let disableProfiles = false;

function bearer(value) {
  const m = value?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function decodeSub(jwt) {
  const parts = String(jwt).split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).sub;
  } catch {
    return null;
  }
}

function gotrueUser(uuid, email) {
  const nowIso = new Date().toISOString();
  return {
    id: uuid,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: nowIso,
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fixtureFetch(input, init) {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const method = String(
    init?.method ?? (typeof input === "object" ? input?.method : undefined) ?? "GET"
  ).toUpperCase();
  const headers = new Headers(
    init?.headers ?? (typeof input === "object" ? input?.headers : undefined) ?? {}
  );
  const u = new URL(url);
  const p = u.pathname;
  requestLog.push(`${method} ${url}`);

  // .single() service-role read of setup flag
  if (
    method === "GET" &&
    p === "/rest/v1/instance_config" &&
    u.searchParams.get("key") === "eq.setup_completed"
  ) {
    return jsonResponse({ value: setupValue });
  }

  // GoTrue user validation — identity keyed off the JWT `sub`
  if (method === "GET" && p === "/auth/v1/user") {
    const sub = decodeSub(bearer(headers.get("authorization")) ?? "");
    if (sub === MEMBER_UUID) return jsonResponse(gotrueUser(MEMBER_UUID, MEMBER_EMAIL));
    if (sub === ADMIN_UUID) return jsonResponse(gotrueUser(ADMIN_UUID, ADMIN_EMAIL));
    return jsonResponse({ msg: "invalid token" }, 401);
  }

  // profiles.role .single()
  if (method === "GET" && p === "/rest/v1/profiles" && !disableProfiles) {
    const uuid = (u.searchParams.get("id") ?? "").replace(/^eq\./, "");
    if (uuid === MEMBER_UUID) return jsonResponse({ role: "member" });
    if (uuid === ADMIN_UUID) return jsonResponse({ role: "admin" });
  }

  thrownLog.push(`${method} ${url}`);
  throw new UnmatchedRequestError(`${method} ${url}`);
}

// ---------------------------------------------------------------------------
// Identity minting: unsigned-but-structurally-valid JWT + @supabase/ssr storage
// cookie ('base64-' + base64url(JSON.stringify(session))).
// ---------------------------------------------------------------------------
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function mintJwt(uuid, email) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { sub: uuid, role: "authenticated", aud: "authenticated", exp: now + 3600, email };
  return `${b64url(header)}.${b64url(payload)}.x`;
}

function mintCookie(uuid, email) {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: mintJwt(uuid, email),
    refresh_token: "rt",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: gotrueUser(uuid, email),
  };
  return "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
}

const memberCookie = mintCookie(MEMBER_UUID, MEMBER_EMAIL);
const adminCookie = mintCookie(ADMIN_UUID, ADMIN_EMAIL);

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------
let ipCounter = 0;
function makeRequest(pathname, { cookie } = {}) {
  const headers = new Headers();
  headers.set("x-forwarded-for", `10.9.0.${ipCounter++ % 250}`);
  if (cookie) headers.set("cookie", `${COOKIE_NAME}=${cookie}`);
  return new NextRequest(new URL(`http://localhost:3000${pathname}`), { headers });
}

function locationOf(response) {
  const loc = response.headers.get("location");
  return loc ? new URL(loc) : null;
}

function digestTarget(err) {
  // NEXT_REDIRECT;replace;<url>;307;
  return String(err?.digest ?? "").split(";")[2];
}

// ---------------------------------------------------------------------------
// Install the seam. Real fetch restored after the suite.
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
globalThis.fetch = fixtureFetch;

test.beforeEach(() => {
  requestLog.length = 0;
  thrownLog.length = 0;
  setupValue = "true";
  disableProfiles = false;
  globalThis.__ADMIN_PROBE__ = { cookies: [], headers: {} };
});

test.after(() => {
  globalThis.fetch = realFetch;
  delete globalThis.__ADMIN_PROBE__;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

// ===========================================================================
// 1. Logged-out /dashboard through REAL middleware -> redirect to /login?next=…
// ===========================================================================
test("1: logged-out GET /dashboard -> 307 redirect to /login with next=/dashboard", async () => {
  const res = await middleware(makeRequest("/dashboard"));

  assert.ok([307, 308].includes(res.status), `expected redirect status, got ${res.status}`);
  const loc = locationOf(res);
  assert.ok(loc, "expected a Location header");
  assert.equal(loc.pathname, "/login");
  assert.equal(loc.searchParams.get("next"), "/dashboard");
  assert.ok(
    requestLog.some((r) => r.includes("/rest/v1/instance_config")),
    "fixture must have served the setup-flag query"
  );
  assert.equal(thrownLog.length, 0, "no unmatched requests expected");
});

// ===========================================================================
// 2. Member-cookie /dashboard through middleware -> passes (not a redirect)
// ===========================================================================
test("2: member-cookie GET /dashboard -> 200, no redirect, /auth/v1/user validated", async () => {
  const res = await middleware(makeRequest("/dashboard", { cookie: memberCookie }));

  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.equal(res.headers.get("location"), null, "must not redirect");
  assert.ok(
    requestLog.some((r) => r.includes("/auth/v1/user")),
    "fixture must have served the GoTrue user validation for the member token"
  );
  assert.equal(thrownLog.length, 0, "no unmatched requests expected");
});

// ===========================================================================
// 3. Member executing REAL AdminLayout -> redirect('/') (NEXT_REDIRECT)
// ===========================================================================
test("3: member identity through AdminLayout -> throws NEXT_REDIRECT to '/'", async () => {
  globalThis.__ADMIN_PROBE__ = {
    cookies: [{ name: COOKIE_NAME, value: memberCookie }],
    headers: {},
  };

  await assert.rejects(
    () => AdminLayout({ children: null }),
    (err) => {
      assert.equal(err.message, "NEXT_REDIRECT");
      assert.equal(digestTarget(err), "/", `redirect target should be '/', got ${digestTarget(err)}`);
      return true;
    }
  );
  assert.ok(
    requestLog.some((r) => r.includes("/rest/v1/profiles")),
    "fixture must have served the profiles role query"
  );
  assert.equal(thrownLog.length, 0, "no unmatched requests expected");
});

// ===========================================================================
// 4. Admin executing REAL AdminLayout -> resolves to a JSX element
// ===========================================================================
test("4: admin identity through AdminLayout -> returns JSX, no throw", async () => {
  globalThis.__ADMIN_PROBE__ = {
    cookies: [{ name: COOKIE_NAME, value: adminCookie }],
    headers: {},
  };

  const element = await AdminLayout({ children: null });

  assert.ok(element && typeof element === "object", "expected a React element object");
  assert.ok("$$typeof" in element, "expected a React element (has $$typeof)");
  assert.ok(
    requestLog.some((r) => r.includes(`/rest/v1/profiles`) && r.includes(`eq.${ADMIN_UUID}`)),
    "fixture must have served the profiles query for the admin uuid"
  );
  assert.equal(thrownLog.length, 0, "no unmatched requests expected");
});

// ===========================================================================
// 5. Hermetic guard (the spike's own negative control): an unfixtured request
//    trips UnmatchedRequestError. Proven two ways —
//    (a) directly at the fixture boundary (the guard's contract), and
//    (b) inside a REAL AdminLayout probe with profiles disabled: the guard
//        fires (recorded in thrownLog) and AdminLayout's behavior flips from
//        "returns JSX" (admin, test 4) to "redirect('/')".
//    NOTE: the Supabase client layers (postgrest-js + auth-js) CATCH thrown
//    fetch errors into result objects, so the throw does NOT propagate to the
//    caller as a rejection. Hermeticity is therefore enforced by asserting
//    thrownLog is empty on positive probes (tests 1-4) and non-empty here.
// ===========================================================================
test("5: unfixtured request trips the hermetic guard (negative control)", async () => {
  // (a) direct boundary contract
  await assert.rejects(
    () => fixtureFetch(`${SUPA_ORIGIN}/rest/v1/unknown_table?select=*`),
    (err) => {
      assert.ok(err instanceof UnmatchedRequestError);
      assert.match(err.message, /GET .*\/rest\/v1\/unknown_table/);
      return true;
    }
  );

  // (b) real code path: admin identity but profiles route removed
  disableProfiles = true;
  globalThis.__ADMIN_PROBE__ = {
    cookies: [{ name: COOKIE_NAME, value: adminCookie }],
    headers: {},
  };

  let flipped;
  try {
    await AdminLayout({ children: null });
    flipped = "returned-jsx"; // would mean the missing profiles read went unnoticed
  } catch (err) {
    flipped = err.message === "NEXT_REDIRECT" ? "redirected" : `other:${err.message}`;
  }

  assert.equal(flipped, "redirected", "admin probe must flip to redirect when profiles is unfixtured");
  assert.ok(
    thrownLog.some((r) => r.includes("/rest/v1/profiles")),
    "the guard must have recorded the unmatched profiles request"
  );
});

// ===========================================================================
// 6. Negative control on REAL middleware semantics: setup_completed='false'.
//    A cache-busted fresh import of the middleware bundle gives a fresh
//    module-level setupCompletedCache, so the guard re-reads the flag and
//    redirects logged-out /dashboard to /setup — proving the probe drives the
//    real setup-gate branch, not a happy path.
// ===========================================================================
test("6: setup-incomplete instance redirects /dashboard -> /setup (real-logic control)", async () => {
  setupValue = "false";
  const { middleware: freshMiddleware } = await import(
    pathToFileURL(mwOut).href + "?fresh=setup-false"
  );

  const res = await freshMiddleware(makeRequest("/dashboard"));

  assert.ok([307, 308].includes(res.status), `expected redirect, got ${res.status}`);
  const loc = locationOf(res);
  assert.ok(loc, "expected a Location header");
  assert.equal(loc.pathname, "/setup", `expected /setup, got ${loc?.pathname}`);
  assert.ok(
    requestLog.some((r) => r.includes("/rest/v1/instance_config")),
    "fixture must have served the setup-flag query"
  );
});
