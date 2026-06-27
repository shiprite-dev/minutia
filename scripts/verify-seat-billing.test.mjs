import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-seat-billing-"));
const bundled = path.join(tempDir, "seat-billing.mjs");
await esbuild.build({
  entryPoints: ["src/lib/billing/seat-billing.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { shouldPromptSeatBilling } = await import(pathToFileURL(bundled).href);

const originalManagedCloud = process.env.NEXT_PUBLIC_MANAGED_CLOUD;
const originalBillingLive = process.env.NEXT_PUBLIC_BILLING_LIVE;
test.afterEach(() => {
  if (originalManagedCloud === undefined) delete process.env.NEXT_PUBLIC_MANAGED_CLOUD;
  else process.env.NEXT_PUBLIC_MANAGED_CLOUD = originalManagedCloud;
  if (originalBillingLive === undefined) delete process.env.NEXT_PUBLIC_BILLING_LIVE;
  else process.env.NEXT_PUBLIC_BILLING_LIVE = originalBillingLive;
});

test("both flags unset: returns false", () => {
  delete process.env.NEXT_PUBLIC_MANAGED_CLOUD;
  delete process.env.NEXT_PUBLIC_BILLING_LIVE;
  assert.equal(shouldPromptSeatBilling(), false);
});

test("managed cloud true, billing-live unset: returns false", () => {
  process.env.NEXT_PUBLIC_MANAGED_CLOUD = "true";
  delete process.env.NEXT_PUBLIC_BILLING_LIVE;
  assert.equal(shouldPromptSeatBilling(), false);
});

test("managed cloud unset, billing-live true: returns false", () => {
  delete process.env.NEXT_PUBLIC_MANAGED_CLOUD;
  process.env.NEXT_PUBLIC_BILLING_LIVE = "true";
  assert.equal(shouldPromptSeatBilling(), false);
});

test("both managed cloud and billing-live true: returns true", () => {
  process.env.NEXT_PUBLIC_MANAGED_CLOUD = "true";
  process.env.NEXT_PUBLIC_BILLING_LIVE = "true";
  assert.equal(shouldPromptSeatBilling(), true);
});
