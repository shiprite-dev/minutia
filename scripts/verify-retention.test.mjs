import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure audio-retention logic so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-retention-"));
const bundled = path.join(tempDir, "retention.mjs");
await esbuild.build({
  entryPoints: ["src/lib/audio/retention.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { resolveAudioRetention, shouldDiscardAudio } = await import(pathToFileURL(bundled).href);

test("resolveAudioRetention defaults to discard when unset or empty", () => {
  assert.equal(resolveAudioRetention(null), "discard_after_transcript");
  assert.equal(resolveAudioRetention(undefined), "discard_after_transcript");
  assert.equal(resolveAudioRetention(""), "discard_after_transcript");
  assert.equal(resolveAudioRetention("discard_after_transcript"), "discard_after_transcript");
});

test("resolveAudioRetention keeps audio for keep_forever and any unrecognized value", () => {
  assert.equal(resolveAudioRetention("keep_forever"), "keep_forever");
  // Never destroy data on an unrecognized setting: treat anything else as keep.
  assert.equal(resolveAudioRetention("keep_30_days"), "keep_forever");
  assert.equal(resolveAudioRetention("garbage"), "keep_forever");
});

test("shouldDiscardAudio only discards on a completed transcript with a non-failed extraction", () => {
  assert.equal(shouldDiscardAudio("discard_after_transcript", "completed", "completed"), true);
  assert.equal(shouldDiscardAudio("discard_after_transcript", "failed"), false, "omitted outcome fails closed");
  assert.equal(shouldDiscardAudio("discard_after_transcript", null), false);
  assert.equal(shouldDiscardAudio("discard_after_transcript", "processing", "completed"), false);
  assert.equal(shouldDiscardAudio("keep_forever", "completed", "completed"), false);
});

// ---------------------------------------------------------------------------
// Extraction-gated cleanup
// ---------------------------------------------------------------------------

test("shouldDiscardAudio requires extraction completed or explicitly skipped", () => {
  assert.equal(shouldDiscardAudio("discard_after_transcript", "completed", "completed"), true);
  assert.equal(shouldDiscardAudio("discard_after_transcript", "completed", "skipped"), true);
  assert.equal(shouldDiscardAudio("discard_after_transcript", "completed", "failed"), false);
});

test("shouldDiscardAudio fails closed when the extraction outcome is omitted", () => {
  assert.equal(shouldDiscardAudio("discard_after_transcript", "completed"), false);
});

test("shouldDiscardAudio still requires a completed transcript", () => {
  assert.equal(shouldDiscardAudio("discard_after_transcript", "processing", "completed"), false);
  assert.equal(shouldDiscardAudio("keep_forever", "completed", "completed"), false);
});
