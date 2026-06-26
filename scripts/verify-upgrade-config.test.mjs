import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-upgrade-config-"));
const bundled = path.join(tempDir, "upgrade-config.mjs");
await esbuild.build({
  entryPoints: ["src/lib/billing/upgrade-config.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { isUpgradeConfigured } = await import(pathToFileURL(bundled).href);

test("upgrade is configured only when both env vars are present", () => {
  assert.equal(
    isUpgradeConfigured({ UPGRADE_SIGNING_SECRET: "s", UPGRADE_CHECKOUT_URL: "https://x" }),
    true,
  );
  assert.equal(isUpgradeConfigured({ UPGRADE_SIGNING_SECRET: "s" }), false);
  assert.equal(isUpgradeConfigured({ UPGRADE_CHECKOUT_URL: "https://x" }), false);
  assert.equal(isUpgradeConfigured({}), false);
});

test("empty string env vars count as unconfigured", () => {
  assert.equal(
    isUpgradeConfigured({ UPGRADE_SIGNING_SECRET: "", UPGRADE_CHECKOUT_URL: "https://x" }),
    false,
  );
  assert.equal(
    isUpgradeConfigured({ UPGRADE_SIGNING_SECRET: "s", UPGRADE_CHECKOUT_URL: "" }),
    false,
  );
});

test("no argument falls through to process.env (returns boolean)", () => {
  const result = isUpgradeConfigured();
  assert.equal(typeof result, "boolean");
});
