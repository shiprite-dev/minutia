import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-rate-limit-"));
const bundled = path.join(tempDir, "rate-limit.mjs");
await esbuild.build({
  entryPoints: ["src/lib/rate-limit.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { authRateBudget, isRateLimited } = await import(pathToFileURL(bundled).href);

test("non-auth paths get no auth budget", () => {
  assert.equal(authRateBudget("/dashboard", "GET", true), null);
  assert.equal(authRateBudget("/api/issues", "POST", true), null);
  assert.equal(authRateBudget("/signup/extra", "GET", true), null);
});

test("auth attempts (POST) keep the strict production budget", () => {
  for (const p of ["/login", "/signup", "/accept-invite", "/auth/callback", "/reset-password"]) {
    const budget = authRateBudget(p, "POST", true);
    assert.equal(budget.bucket, "auth-attempt");
    assert.equal(budget.limit, 10);
  }
});

test("auth page loads (GET/HEAD) get a budget a human cannot trip", () => {
  const get = authRateBudget("/signup", "GET", true);
  const head = authRateBudget("/signup", "HEAD", true);
  assert.equal(get.bucket, "auth-page");
  assert.equal(head.bucket, "auth-page");
  assert.ok(get.limit >= 120, "page budget must absorb prefetches, RSC requests, and refreshes");
});

test("page loads and attempts use separate buckets so prefetches cannot lock out submissions", () => {
  const page = authRateBudget("/login", "GET", true);
  const attempt = authRateBudget("/login", "POST", true);
  assert.notEqual(page.bucket, attempt.bucket);
});

test("development budgets absorb parallel test workers", () => {
  assert.ok(authRateBudget("/login", "POST", false).limit >= 200);
  assert.ok(authRateBudget("/login", "GET", false).limit >= 1000);
});

test("isRateLimited allows up to the limit, blocks past it, and resets after the window", () => {
  const key = "t1";
  for (let i = 0; i < 3; i++) assert.equal(isRateLimited(key, 3, 60_000, 1_000), false);
  assert.equal(isRateLimited(key, 3, 60_000, 1_000), true);
  assert.equal(isRateLimited(key, 3, 60_000, 61_001), false);
});

test("isRateLimited keys are independent", () => {
  assert.equal(isRateLimited("a", 1, 60_000, 1_000), false);
  assert.equal(isRateLimited("a", 1, 60_000, 1_000), true);
  assert.equal(isRateLimited("b", 1, 60_000, 1_000), false);
});
