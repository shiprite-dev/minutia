// Smoke test for scripts/authz/bundle.mjs + identity.mjs: proves the extracted harness
// modules still bundle the real middleware and mint identity the same way the proven
// spike (scripts/verify-authz-spike.test.mjs) does.
//
// Run: node --test scripts/authz/smoke-bundle.test.mjs

import "./env.mjs"; // MUST be first: side-effect module that sets the fixture Supabase env.

import test from "node:test";
import assert from "node:assert/strict";

const { bundleMiddleware, cleanup } = await import("./bundle.mjs");
const { mintCookie, COOKIE_NAME } = await import("./identity.mjs");

test("bundleMiddleware() bundles the real middleware graph", async () => {
  const { middleware, NextRequest, NextResponse } = await bundleMiddleware();
  assert.equal(typeof middleware, "function", "middleware should be a function");
  assert.equal(typeof NextRequest, "function", "NextRequest should be a constructor");
  assert.equal(typeof NextResponse, "function", "NextResponse should be a constructor");
});

test("identity.mjs mints cookies and derives COOKIE_NAME the same way the app does", () => {
  const cookie = mintCookie("11111111-1111-4111-8111-111111111111", { email: "member@fixture.local" });
  assert.ok(cookie.startsWith("base64-"), "mintCookie should produce a base64- storage cookie");
  assert.equal(COOKIE_NAME, "sb-fixture-auth-token");
});

test.after(() => {
  cleanup();
});
