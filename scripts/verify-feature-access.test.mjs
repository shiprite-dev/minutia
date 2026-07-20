import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-feature-access-"));
const bundled = path.join(tempDir, "feature-access.mjs");
await esbuild.build({
  entryPoints: ["src/lib/feature-access.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { isFeatureGatingEnabled, isMemberInviteAllowed } = await import(
  pathToFileURL(bundled).href
);

const stubNext = path.join(tempDir, "stub-next-server.mjs");
fs.writeFileSync(
  stubNext,
  "export const NextResponse = { json(body, init) { return { body, status: init?.status ?? 200 }; } };\n",
);
const stubSupabase = path.join(tempDir, "stub-supabase-server.mjs");
fs.writeFileSync(
  stubSupabase,
  "export async function createClient() { return globalThis.__aiAccessSupabase; }\n",
);
const accessBundle = path.join(tempDir, "access.mjs");
await esbuild.build({
  entryPoints: ["src/lib/ai/access.ts"],
  outfile: accessBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  alias: {
    "next/server": stubNext,
    "@/lib/supabase/server": stubSupabase,
    "@": path.join(root, "src"),
  },
});
const { requireAiAccess } = await import(pathToFileURL(accessBundle).href);

function mockSupabase({ user, profile = null, profileError = null }) {
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({ data: profile, error: profileError }),
  };
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => query,
  };
}

async function withCapturedErrors(fn) {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.error = originalError;
  }
}

const USER_ID = "user-abc-123";

const original = process.env.NEXT_PUBLIC_FEATURE_GATING;
test.afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_FEATURE_GATING;
  else process.env.NEXT_PUBLIC_FEATURE_GATING = original;
});

test("feature gating is off by default", () => {
  delete process.env.NEXT_PUBLIC_FEATURE_GATING;
  assert.equal(isFeatureGatingEnabled(), false);
});

test("feature gating is on only when the flag is exactly 'true'", () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "true";
  assert.equal(isFeatureGatingEnabled(), true);
  process.env.NEXT_PUBLIC_FEATURE_GATING = "false";
  assert.equal(isFeatureGatingEnabled(), false);
  process.env.NEXT_PUBLIC_FEATURE_GATING = "1";
  assert.equal(isFeatureGatingEnabled(), false);
  process.env.NEXT_PUBLIC_FEATURE_GATING = "TRUE";
  assert.equal(isFeatureGatingEnabled(), false);
});

test("invites are always allowed when gating is off (self-host default)", () => {
  delete process.env.NEXT_PUBLIC_FEATURE_GATING;
  assert.equal(isMemberInviteAllowed(false), true);
  assert.equal(isMemberInviteAllowed(true), true);
});

test("gated free workspace cannot invite (solo); full access can", () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "true";
  assert.equal(isMemberInviteAllowed(false), false);
  assert.equal(isMemberInviteAllowed(true), true);
});

test("only the exact 'true' flag gates invites", () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "1";
  assert.equal(isMemberInviteAllowed(false), true);
  process.env.NEXT_PUBLIC_FEATURE_GATING = "TRUE";
  assert.equal(isMemberInviteAllowed(false), true);
});

test("non-boolean has_full_access is treated as no access under gating", () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "true";
  assert.equal(isMemberInviteAllowed(undefined), false);
  assert.equal(isMemberInviteAllowed(null), false);
});

test("requireAiAccess logs an error and 403s when the entitlement is absent", async () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "true";
  globalThis.__aiAccessSupabase = mockSupabase({
    user: { id: USER_ID },
    profile: { has_full_access: false },
  });
  const { result, logs } = await withCapturedErrors(() => requireAiAccess());
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "FEATURE_UNAVAILABLE");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[ai-access\]/);
  assert.match(logs[0], new RegExp(USER_ID));
  assert.match(logs[0], /FEATURE_UNAVAILABLE/);
});

test("requireAiAccess logs a distinct error when the profile read fails", async () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "true";
  globalThis.__aiAccessSupabase = mockSupabase({
    user: { id: USER_ID },
    profileError: { message: "row not found" },
  });
  const { result, logs } = await withCapturedErrors(() => requireAiAccess());
  assert.equal(result.status, 403);
  assert.equal(result.body.code, undefined);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[ai-access\]/);
  assert.match(logs[0], new RegExp(USER_ID));
  assert.match(logs[0], /profile-read-failure/);
  assert.doesNotMatch(logs[0], /FEATURE_UNAVAILABLE/);
});

test("requireAiAccess grants access silently and logs nothing", async () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "true";
  globalThis.__aiAccessSupabase = mockSupabase({
    user: { id: USER_ID },
    profile: { has_full_access: true },
  });
  const { result, logs } = await withCapturedErrors(() => requireAiAccess());
  assert.equal(result, null);
  assert.equal(logs.length, 0);
});

test.after(() => {
  delete globalThis.__aiAccessSupabase;
});
