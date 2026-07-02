import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure sender-resolution logic for node:test (repo verifier pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-sender-"));
const bundled = path.join(tempDir, "sender.mjs");
await esbuild.build({
  entryPoints: ["src/lib/email-sender.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const {
  resolveSenderFrom,
  isDeliverableSender,
  formatSender,
  SENDER_NOT_CONFIGURED_MESSAGE,
} = await import(pathToFileURL(bundled).href);

test("resolveSenderFrom prefers explicit, then configured, then env, else null", () => {
  assert.equal(
    resolveSenderFrom("x@ex.com", "cfg@ex.com", "env@ex.com", "adm@ex.com"),
    "x@ex.com"
  );
  assert.equal(resolveSenderFrom(undefined, "cfg@ex.com", "env@ex.com"), "cfg@ex.com");
  assert.equal(resolveSenderFrom("", "", "env@ex.com"), "env@ex.com");
  assert.equal(resolveSenderFrom(undefined, undefined, undefined, "adm@ex.com"), "adm@ex.com");
  assert.equal(resolveSenderFrom(undefined, undefined, undefined, undefined), null);
});

test("resolveSenderFrom ignores blank/whitespace candidates", () => {
  assert.equal(resolveSenderFrom("   ", "cfg@ex.com"), "cfg@ex.com");
  assert.equal(resolveSenderFrom(null, "  ", "env@ex.com"), "env@ex.com");
});

test("isDeliverableSender accepts real addresses (bare or Name <addr>)", () => {
  assert.equal(isDeliverableSender("hi@getminutia.com"), true);
  assert.equal(isDeliverableSender("Minutia <hi@getminutia.com>"), true);
  assert.equal(isDeliverableSender("a.b+tag@sub.example.co.uk"), true);
});

test("isDeliverableSender rejects empty, malformed, and non-routable domains", () => {
  assert.equal(isDeliverableSender(undefined), false);
  assert.equal(isDeliverableSender(null), false);
  assert.equal(isDeliverableSender(""), false);
  assert.equal(isDeliverableSender("Minutia"), false); // name only, no address
  assert.equal(isDeliverableSender("notanemail"), false);
  assert.equal(isDeliverableSender("noreply@localhost"), false); // the buggy default
  assert.equal(isDeliverableSender("Minutia <noreply@localhost>"), false);
  assert.equal(isDeliverableSender("dev@app.local"), false);
  assert.equal(isDeliverableSender("Minutia <>"), false); // empty angle addr
});

test("formatSender wraps a bare address and leaves Name <addr> intact", () => {
  assert.equal(formatSender("hi@getminutia.com"), "Minutia <hi@getminutia.com>");
  assert.equal(formatSender("Team <hi@getminutia.com>"), "Team <hi@getminutia.com>");
});

test("SENDER_NOT_CONFIGURED_MESSAGE is actionable (mentions where to set it)", () => {
  assert.match(SENDER_NOT_CONFIGURED_MESSAGE, /sender/i);
  assert.match(SENDER_NOT_CONFIGURED_MESSAGE, /settings|EMAIL_FROM/i);
});
