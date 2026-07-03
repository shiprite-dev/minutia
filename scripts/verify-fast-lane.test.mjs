import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure fast-lane logic so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-fast-lane-"));
const bundled = path.join(tempDir, "fast-lane.mjs");
await esbuild.build({
  entryPoints: ["src/lib/transcription/fast-lane.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { assembleFastTranscript, planSegmentResume } = await import(pathToFileURL(bundled).href);

const row = (seq, status, transcript_text) => ({
  seq,
  status,
  transcript_text,
  storage_path: `m1/seg-${seq}.webm`,
});

test("assembleFastTranscript returns empty string for no rows", () => {
  assert.equal(assembleFastTranscript([]), "");
});

test("assembleFastTranscript orders by seq, joins with blank line, does not mutate input", () => {
  const rows = [row(2, "completed", "c"), row(0, "completed", "a"), row(1, "completed", "b")];
  const snapshot = rows.map((r) => r.seq);
  assert.equal(assembleFastTranscript(rows), "a\n\nb\n\nc");
  assert.deepEqual(rows.map((r) => r.seq), snapshot, "input array order preserved");
});

test("assembleFastTranscript skips non-completed and empty-text rows, trims text", () => {
  const rows = [
    row(0, "completed", "  keep0  "),
    row(1, "failed", "dropme"),
    row(2, "uploaded", "dropme"),
    row(3, "processing", "dropme"),
    row(4, "completed", null),
    row(5, "completed", ""),
    row(6, "completed", "   "),
    row(7, "completed", "keep7"),
  ];
  assert.equal(assembleFastTranscript(rows), "keep0\n\nkeep7");
});

test("planSegmentResume on empty rows is unusable with empty arrays", () => {
  const plan = planSegmentResume([]);
  assert.equal(plan.usable, false);
  assert.deepEqual(plan.retry, []);
  assert.deepEqual(plan.completed, []);
});

test("planSegmentResume all completed => no retry, usable", () => {
  const rows = [row(0, "completed", "a"), row(1, "completed", "b")];
  const plan = planSegmentResume(rows);
  assert.deepEqual(plan.retry, []);
  assert.deepEqual(plan.completed.map((r) => r.seq), [0, 1]);
  assert.equal(plan.usable, true);
});

test("planSegmentResume mixes statuses: retry in seq order, completed only real text", () => {
  const rows = [
    row(0, "completed", "done"),
    row(1, "failed", null),
    row(2, "uploaded", null),
    row(3, "processing", null),
    row(4, "completed", "   "),
  ];
  const plan = planSegmentResume(rows);
  assert.deepEqual(plan.retry.map((r) => r.seq), [1, 2, 3, 4], "completed-with-empty counts as retry");
  assert.deepEqual(plan.completed.map((r) => r.seq), [0]);
  assert.equal(plan.usable, true);
});

test("planSegmentResume single failed row is usable and queued for retry", () => {
  const plan = planSegmentResume([row(0, "failed", null)]);
  assert.equal(plan.usable, true);
  assert.deepEqual(plan.retry.map((r) => r.seq), [0]);
  assert.deepEqual(plan.completed, []);
});
