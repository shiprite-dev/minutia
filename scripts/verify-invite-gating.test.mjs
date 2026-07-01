import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure feature-access logic so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-invite-gating-"));
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
const { isMemberInviteAllowed } = await import(pathToFileURL(bundled).href);

const original = process.env.NEXT_PUBLIC_FEATURE_GATING;
test.afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_FEATURE_GATING;
  else process.env.NEXT_PUBLIC_FEATURE_GATING = original;
});

test("gating OFF (self-host default): inviting is always allowed", () => {
  delete process.env.NEXT_PUBLIC_FEATURE_GATING;
  assert.equal(isMemberInviteAllowed(false), true);
  assert.equal(isMemberInviteAllowed(true), true);
});

test("gating ON without full access: inviting is blocked (free = solo)", () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "true";
  assert.equal(isMemberInviteAllowed(false), false);
});

test("gating ON with full access: inviting is allowed", () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "true";
  assert.equal(isMemberInviteAllowed(true), true);
});

test("only the exact 'true' flag turns gating on", () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "1";
  assert.equal(isMemberInviteAllowed(false), true);
  process.env.NEXT_PUBLIC_FEATURE_GATING = "TRUE";
  assert.equal(isMemberInviteAllowed(false), true);
});

test("non-boolean has_full_access is treated as no access under gating", () => {
  process.env.NEXT_PUBLIC_FEATURE_GATING = "true";
  // Defensive: only a strict boolean true grants access.
  assert.equal(isMemberInviteAllowed(undefined), false);
  assert.equal(isMemberInviteAllowed(null), false);
});
