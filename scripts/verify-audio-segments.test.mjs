import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure segment logic so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-segments-"));
const bundled = path.join(tempDir, "segments.mjs");
await esbuild.build({
  entryPoints: ["src/lib/audio/segments.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const {
  SEGMENT_TARGET_BYTES,
  SEGMENT_MAX_MS,
  SEGMENT_MIN_BYTES,
  isSegmentableMime,
  splitInitSegment,
  cutAtLastClusterStart,
  buildSegmentFile,
  shouldCutSegment,
  segmentStoragePath,
} = await import(pathToFileURL(bundled).href);

const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

// Build a buffer of `length` filler bytes with the cluster id planted at each offset.
function makeBuffer(length, offsets) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = 0xaa;
  for (const off of offsets) bytes.set(CLUSTER_ID, off);
  return bytes;
}

test("splitInitSegment returns null when no cluster is present yet", () => {
  const bytes = makeBuffer(64, []);
  assert.equal(splitInitSegment(bytes), null);
});

test("splitInitSegment splits at the first cluster and round-trips", () => {
  const bytes = makeBuffer(120, [10, 60]);
  const out = splitInitSegment(bytes);
  assert.ok(out, "split returns an object");
  assert.equal(out.init.length, 10);
  assert.deepEqual([...out.rest.slice(0, 4)], CLUSTER_ID);
  assert.deepEqual([...buildSegmentFile(out.init, out.rest)], [...bytes]);
});

test("splitInitSegment with a cluster at offset 0 yields an empty init", () => {
  const bytes = makeBuffer(80, [0, 40]);
  const out = splitInitSegment(bytes);
  assert.ok(out);
  assert.equal(out.init.length, 0);
  assert.equal(out.rest.length, bytes.length);
});

test("cutAtLastClusterStart cuts before the trailing (still-growing) cluster", () => {
  const bytes = makeBuffer(300, [10, 60, 200]);
  const { head, tail } = cutAtLastClusterStart(bytes);
  assert.equal(head.length, 200);
  assert.equal(tail.length, 100);
  assert.deepEqual([...head], [...bytes.slice(0, 200)]);
  assert.deepEqual([...tail], [...bytes.slice(200)]);
});

test("cutAtLastClusterStart with a single cluster never cuts", () => {
  const bytes = makeBuffer(120, [10]);
  const { head, tail } = cutAtLastClusterStart(bytes);
  assert.equal(head.length, 0);
  assert.deepEqual([...tail], [...bytes]);
});

test("cutAtLastClusterStart with no clusters never cuts", () => {
  const bytes = makeBuffer(120, []);
  const { head, tail } = cutAtLastClusterStart(bytes);
  assert.equal(head.length, 0);
  assert.deepEqual([...tail], [...bytes]);
});

test("buildSegmentFile concatenates exactly", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5]);
  assert.deepEqual([...buildSegmentFile(a, b)], [1, 2, 3, 4, 5]);
});

test("shouldCutSegment truth table", () => {
  assert.equal(shouldCutSegment(5 * 1024 * 1024, 60_000), true);
  assert.equal(shouldCutSegment(100 * 1024, 600_000), false);
  assert.equal(shouldCutSegment(1024 * 1024, 360_000), true);
  assert.equal(shouldCutSegment(1024 * 1024, 60_000), false);
  assert.equal(shouldCutSegment(SEGMENT_MIN_BYTES, SEGMENT_MAX_MS), true);
});

test("shouldCutSegment constants match the contract", () => {
  assert.equal(SEGMENT_TARGET_BYTES, 4 * 1024 * 1024);
  assert.equal(SEGMENT_MAX_MS, 5 * 60_000);
  assert.equal(SEGMENT_MIN_BYTES, 256 * 1024);
});

test("isSegmentableMime is true only for audio/webm", () => {
  assert.equal(isSegmentableMime("audio/webm;codecs=opus"), true);
  assert.equal(isSegmentableMime("audio/webm"), true);
  assert.equal(isSegmentableMime("AUDIO/WEBM"), true);
  assert.equal(isSegmentableMime("audio/mp4"), false);
  assert.equal(isSegmentableMime("audio/ogg;codecs=opus"), false);
});

test("segmentStoragePath composes the meeting-scoped path", () => {
  assert.equal(segmentStoragePath("m1", 3), "m1/seg-3.webm");
});
