import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-admin-capabilities-"));
const bundled = path.join(tempDir, "capabilities.mjs");
await esbuild.build({
  entryPoints: ["src/lib/admin/capabilities.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { isManagedCloud, getAdminCapabilities } = await import(pathToFileURL(bundled).href);

const original = process.env.NEXT_PUBLIC_MANAGED_CLOUD;
test.afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_MANAGED_CLOUD;
  else process.env.NEXT_PUBLIC_MANAGED_CLOUD = original;
});

test("flag unset: isManagedCloud is false and every capability is true", () => {
  delete process.env.NEXT_PUBLIC_MANAGED_CLOUD;
  assert.equal(isManagedCloud(), false);
  const caps = getAdminCapabilities();
  assert.equal(caps.instanceIdentity, true);
  assert.equal(caps.email, true);
  assert.equal(caps.ai, true);
  assert.equal(caps.slackWebhook, true);
  assert.equal(caps.reminderWebhook, true);
  assert.equal(caps.retroToggle, true);
  assert.equal(caps.promptLinks, true);
  assert.equal(caps.users, true);
  assert.equal(caps.upgradePrompt, true);
});

test("NEXT_PUBLIC_MANAGED_CLOUD=true: isManagedCloud is true and cloud subset enforced", () => {
  process.env.NEXT_PUBLIC_MANAGED_CLOUD = "true";
  assert.equal(isManagedCloud(), true);
  const caps = getAdminCapabilities();
  // cloud-only capabilities that stay enabled
  assert.equal(caps.instanceIdentity, true);
  assert.equal(caps.slackWebhook, true);
  assert.equal(caps.users, true);
  assert.equal(caps.upgradePrompt, true);
  // capabilities hidden in cloud
  assert.equal(caps.email, false);
  assert.equal(caps.ai, false);
  assert.equal(caps.reminderWebhook, false);
  assert.equal(caps.retroToggle, false);
  assert.equal(caps.promptLinks, false);
});

test("NEXT_PUBLIC_MANAGED_CLOUD=false: treated as self-host (all true)", () => {
  process.env.NEXT_PUBLIC_MANAGED_CLOUD = "false";
  assert.equal(isManagedCloud(), false);
  const caps = getAdminCapabilities();
  assert.equal(caps.instanceIdentity, true);
  assert.equal(caps.email, true);
  assert.equal(caps.ai, true);
  assert.equal(caps.slackWebhook, true);
  assert.equal(caps.reminderWebhook, true);
  assert.equal(caps.retroToggle, true);
  assert.equal(caps.promptLinks, true);
  assert.equal(caps.users, true);
  assert.equal(caps.upgradePrompt, true);
});

test("any non-'true' value: treated as self-host (all true)", () => {
  for (const val of ["1", "TRUE", "yes", "on", ""]) {
    process.env.NEXT_PUBLIC_MANAGED_CLOUD = val;
    assert.equal(isManagedCloud(), false, `expected false for value "${val}"`);
    const caps = getAdminCapabilities();
    assert.equal(caps.email, true, `expected email=true for value "${val}"`);
    assert.equal(caps.ai, true, `expected ai=true for value "${val}"`);
    assert.equal(caps.reminderWebhook, true, `expected reminderWebhook=true for value "${val}"`);
    assert.equal(caps.retroToggle, true, `expected retroToggle=true for value "${val}"`);
    assert.equal(caps.promptLinks, true, `expected promptLinks=true for value "${val}"`);
  }
});
