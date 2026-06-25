import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure upsell core so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-upsell-"));
const bundled = path.join(tempDir, "upsell.mjs");
await esbuild.build({
  entryPoints: ["src/lib/upsell/index.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const {
  resolveUpsellCta,
  shouldShowNudge,
  nudgeStorageKey,
  UPSELL_DEFAULT_CTA_LABEL,
  NUDGE_COOLDOWN_MS,
} = await import(pathToFileURL(bundled).href);

const DAY = 86_400_000;

// ---- resolveUpsellCta ------------------------------------------------------

test("no url renders an informational-only nudge (null CTA)", () => {
  assert.equal(resolveUpsellCta(), null);
  assert.equal(resolveUpsellCta(null), null);
  assert.equal(resolveUpsellCta(""), null);
  assert.equal(resolveUpsellCta("   "), null);
});

test("non-http(s) urls are rejected (no javascript:/data: injection)", () => {
  assert.equal(resolveUpsellCta("javascript:alert(1)"), null);
  assert.equal(resolveUpsellCta("data:text/html,<script>1</script>"), null);
  assert.equal(resolveUpsellCta("/relative/upgrade"), null);
  assert.equal(resolveUpsellCta("ftp://x.test/u"), null);
});

test("valid http(s) url yields a CTA with the default label", () => {
  assert.deepEqual(resolveUpsellCta("https://x.test/u"), {
    href: "https://x.test/u",
    label: UPSELL_DEFAULT_CTA_LABEL,
  });
  assert.deepEqual(resolveUpsellCta("http://x.test/u"), {
    href: "http://x.test/u",
    label: UPSELL_DEFAULT_CTA_LABEL,
  });
});

test("a provided label is honored, trimmed, and falls back when blank", () => {
  assert.equal(resolveUpsellCta("https://x.test/u", "  See options  ")?.label, "See options");
  assert.equal(resolveUpsellCta("https://x.test/u", "")?.label, UPSELL_DEFAULT_CTA_LABEL);
});

test("a caller-supplied default label overrides the built-in default", () => {
  assert.equal(
    resolveUpsellCta("https://x.test/u", null, "Enable AI")?.label,
    "Enable AI",
  );
});

// ---- shouldShowNudge (dismiss + cooldown) ----------------------------------

test("a never-dismissed nudge always shows", () => {
  assert.equal(shouldShowNudge(null, 1_000_000), true);
  assert.equal(shouldShowNudge(undefined, 1_000_000), true);
});

test("a nudge stays hidden within the cooldown window", () => {
  const dismissedAt = 1_000_000;
  assert.equal(shouldShowNudge(dismissedAt, dismissedAt + DAY), false);
  assert.equal(shouldShowNudge(dismissedAt, dismissedAt + 13 * DAY), false);
});

test("a nudge reappears once the cooldown has elapsed", () => {
  const dismissedAt = 1_000_000;
  assert.equal(shouldShowNudge(dismissedAt, dismissedAt + NUDGE_COOLDOWN_MS), true);
  assert.equal(shouldShowNudge(dismissedAt, dismissedAt + 30 * DAY), true);
});

test("a corrupt (NaN) dismissal timestamp shows the nudge rather than hiding forever", () => {
  assert.equal(shouldShowNudge(Number.NaN, 1_000_000), true);
});

test("the default cooldown is 14 days", () => {
  assert.equal(NUDGE_COOLDOWN_MS, 14 * DAY);
});

// ---- nudgeStorageKey -------------------------------------------------------

test("storage key is namespaced per slot", () => {
  assert.equal(nudgeStorageKey("capacity"), "minutia.upsell.capacity.dismissedAt");
  assert.equal(nudgeStorageKey("ai"), "minutia.upsell.ai.dismissedAt");
});

// ---- OSS boundary: no pricing/tier language in defaults --------------------

test("the default CTA label carries no pricing or tier language", () => {
  assert.doesNotMatch(
    UPSELL_DEFAULT_CTA_LABEL,
    /\$|price|pricing|plan|tier|pro\b|month|seat/i,
  );
});
