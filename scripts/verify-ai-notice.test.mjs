import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-ai-notice-"));
const bundled = path.join(tempDir, "notice.mjs");
await esbuild.build({
  entryPoints: ["src/lib/ai/notice.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { resolveAiNoticeCta, AI_NOTICE_DEFAULT_CTA_LABEL } = await import(
  pathToFileURL(bundled).href
);

test("no url renders an informational-only notice (null CTA)", () => {
  assert.equal(resolveAiNoticeCta(), null);
  assert.equal(resolveAiNoticeCta(null), null);
  assert.equal(resolveAiNoticeCta(""), null);
  assert.equal(resolveAiNoticeCta("   "), null);
});

test("non-http(s) urls are rejected (no javascript:/data: injection)", () => {
  assert.equal(resolveAiNoticeCta("javascript:alert(1)"), null);
  assert.equal(resolveAiNoticeCta("data:text/html,<script>1</script>"), null);
  assert.equal(resolveAiNoticeCta("/relative/upgrade"), null);
  assert.equal(resolveAiNoticeCta("ftp://x.test/u"), null);
});

test("valid http(s) url yields a neutral CTA with the default label", () => {
  assert.deepEqual(resolveAiNoticeCta("https://x.test/learn"), {
    href: "https://x.test/learn",
    label: AI_NOTICE_DEFAULT_CTA_LABEL,
  });
  assert.deepEqual(resolveAiNoticeCta("http://x.test/learn"), {
    href: "http://x.test/learn",
    label: AI_NOTICE_DEFAULT_CTA_LABEL,
  });
});

test("a provided label is honored, trimmed, and falls back when blank", () => {
  assert.equal(resolveAiNoticeCta("https://x.test/u", "  See options  ")?.label, "See options");
  assert.equal(resolveAiNoticeCta("https://x.test/u", "")?.label, AI_NOTICE_DEFAULT_CTA_LABEL);
});

test("the default CTA label carries no pricing or tier language", () => {
  assert.doesNotMatch(AI_NOTICE_DEFAULT_CTA_LABEL, /\$|price|pricing|plan|tier|upgrade|pro\b|free|month|seat/i);
});
