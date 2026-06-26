import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-checkout-response-"));
const bundled = path.join(tempDir, "checkout-response.mjs");

await esbuild.build({
  entryPoints: ["src/lib/billing/checkout-response.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});

const { extractCheckoutUrl } = await import(pathToFileURL(bundled).href);

test("ok + valid url returns the url string", () => {
  assert.equal(extractCheckoutUrl(true, { url: "https://checkout.example.com/pay" }), "https://checkout.example.com/pay");
});

test("ok + missing url property returns null", () => {
  assert.equal(extractCheckoutUrl(true, { other: "field" }), null);
});

test("ok + non-object body returns null", () => {
  assert.equal(extractCheckoutUrl(true, "not-an-object"), null);
  assert.equal(extractCheckoutUrl(true, 42), null);
  assert.equal(extractCheckoutUrl(true, null), null);
});

test("not-ok returns null regardless of body", () => {
  assert.equal(extractCheckoutUrl(false, { url: "https://checkout.example.com/pay" }), null);
  assert.equal(extractCheckoutUrl(false, null), null);
});

test("ok + empty-string url returns null", () => {
  assert.equal(extractCheckoutUrl(true, { url: "" }), null);
});
