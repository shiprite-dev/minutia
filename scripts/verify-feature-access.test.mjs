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
const { isFeatureGatingEnabled } = await import(pathToFileURL(bundled).href);

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
