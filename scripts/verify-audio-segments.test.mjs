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

// Bundle the DI'd sequencer so node:test can drive it with fake deps.
const bundledPipeline = path.join(tempDir, "segment-pipeline.mjs");
await esbuild.build({
  entryPoints: ["src/lib/audio/segment-pipeline.ts"],
  outfile: bundledPipeline,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { createSegmentPipeline } = await import(pathToFileURL(bundledPipeline).href);

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

// --- Segment pipeline sequencer (Task 2) -----------------------------------

// Let all pending microtasks and one macrotask turn settle so the internal
// worker can advance between deferred resolutions.
const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A deps harness that records call order and hands back controllable promises.
function makeDeps(opts = {}) {
  const calls = [];
  const statuses = [];
  const uploads = [];
  const transcribes = [];
  const deps = {
    upload(path, bytes) {
      calls.push(`upload:${path}`);
      if (opts.autoUpload) return opts.autoUpload(path, bytes);
      const d = deferred();
      uploads.push({ path, bytes, ...d });
      return d.promise;
    },
    transcribe(seq, path) {
      calls.push(`transcribe:${seq}`);
      if (opts.autoTranscribe) return opts.autoTranscribe(seq, path);
      const d = deferred();
      transcribes.push({ seq, path, ...d });
      return d.promise;
    },
    onStatus(status) {
      statuses.push(status);
    },
  };
  if (opts.now) deps.now = opts.now;
  return { deps, calls, statuses, uploads, transcribes };
}

// init (no cluster) + clusterA + filler + clusterB, big enough to size-cut.
function bigTwoClusterChunk() {
  const total = SEGMENT_TARGET_BYTES + 4096;
  return makeBuffer(total, [16, SEGMENT_TARGET_BYTES + 1024]);
}

// init + two clusters, above SEGMENT_MIN_BYTES but below target (time-cut only).
function smallTwoClusterChunk() {
  const total = SEGMENT_MIN_BYTES + 4096;
  return makeBuffer(total, [16, SEGMENT_MIN_BYTES + 1024]);
}

test("pipeline: non-segmentable mime is off and never touches deps", async () => {
  const { deps, calls, statuses } = makeDeps();
  const p = createSegmentPipeline("m1", "audio/mp4", deps);
  assert.equal(p.status().state, "off");
  await p.push(bigTwoClusterChunk());
  await p.flushFinal();
  assert.equal(p.status().state, "off");
  assert.deepEqual(calls, []);
  assert.deepEqual(statuses, []);
});

test("pipeline: segmentable mime starts active with zero counters", () => {
  const { deps } = makeDeps();
  const p = createSegmentPipeline("m1", "audio/webm;codecs=opus", deps);
  assert.deepEqual(p.status(), { state: "active", segmentsDone: 0, segmentsTotal: 0 });
});

test("pipeline: nothing uploads until a cluster boundary is seen", async () => {
  const { deps, calls } = makeDeps();
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(makeBuffer(128, [])); // no cluster id at all
  assert.deepEqual(calls, []);
  assert.equal(p.status().segmentsTotal, 0);
});

test("pipeline: size-based cut uploads seg-0 with init prepended then transcribes", async () => {
  const { deps, calls, uploads, transcribes } = makeDeps();
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(bigTwoClusterChunk());
  assert.deepEqual(calls, ["upload:m1/seg-0.webm"]);
  assert.equal(p.status().segmentsTotal, 1);
  assert.equal(p.status().segmentsDone, 0);
  // uploaded bytes = init (first 16) + whole clusters (head), init leads the file.
  assert.deepEqual([...uploads[0].bytes.slice(0, 4)], [0xaa, 0xaa, 0xaa, 0xaa]);
  assert.deepEqual([...uploads[0].bytes.slice(16, 20)], [0x1f, 0x43, 0xb6, 0x75]);
  uploads[0].resolve();
  await flush();
  assert.deepEqual(calls, ["upload:m1/seg-0.webm", "transcribe:0"]);
  transcribes[0].resolve({ ok: true });
  await flush();
  assert.equal(p.status().segmentsDone, 1);
});

test("pipeline: time-based cut fires when msSinceLastCut exceeds the max", async () => {
  let clock = 1_000;
  const { deps, calls } = makeDeps({ now: () => clock });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  clock += SEGMENT_MAX_MS + 1;
  await p.push(smallTwoClusterChunk());
  assert.deepEqual(calls, ["upload:m1/seg-0.webm"]);
});

test("pipeline: serializes cuts in seq order across in-flight uploads", async () => {
  const { deps, calls, uploads, transcribes } = makeDeps();
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(bigTwoClusterChunk()); // cut seg-0, upload0 in flight
  await p.push(bigTwoClusterChunk()); // cut seg-1, queued behind seg-0
  assert.deepEqual(calls, ["upload:m1/seg-0.webm"]);
  uploads[0].resolve();
  await flush();
  assert.deepEqual(calls, ["upload:m1/seg-0.webm", "transcribe:0"]);
  transcribes[0].resolve({ ok: true });
  await flush();
  assert.deepEqual(calls, ["upload:m1/seg-0.webm", "transcribe:0", "upload:m1/seg-1.webm"]);
  uploads[1].resolve();
  await flush();
  transcribes[1].resolve({ ok: true });
  await flush();
  assert.deepEqual(calls, [
    "upload:m1/seg-0.webm",
    "transcribe:0",
    "upload:m1/seg-1.webm",
    "transcribe:1",
  ]);
  assert.equal(p.status().segmentsDone, 2);
});

test("pipeline: retries a rejected upload once then continues", async () => {
  let attempt = 0;
  const { deps, calls } = makeDeps({
    autoUpload: () => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error("net")) : Promise.resolve();
    },
    autoTranscribe: () => Promise.resolve({ ok: true }),
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(bigTwoClusterChunk());
  await flush();
  // upload called twice (fail then succeed), transcribe once.
  assert.deepEqual(calls.filter((c) => c.startsWith("upload")).length, 2);
  assert.equal(p.status().segmentsDone, 1);
  assert.equal(p.status().state, "active");
});

test("pipeline: retries only transcribe when upload succeeded, abandons after 2nd fail", async () => {
  let up = 0;
  let tr = 0;
  const { deps } = makeDeps({
    autoUpload: () => {
      up += 1;
      return Promise.resolve();
    },
    autoTranscribe: () => {
      tr += 1;
      return Promise.resolve({ ok: false });
    },
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(bigTwoClusterChunk());
  await flush();
  assert.equal(up, 1, "upload not repeated when it succeeded");
  assert.equal(tr, 2, "transcribe retried exactly once");
  assert.equal(p.status().segmentsDone, 0, "abandoned segment not counted");
  assert.equal(p.status().state, "active", "pipeline keeps running");
});

test("pipeline: a thrown transcribe is treated like {ok:false}", async () => {
  let tr = 0;
  const { deps } = makeDeps({
    autoUpload: () => Promise.resolve(),
    autoTranscribe: () => {
      tr += 1;
      return Promise.reject(new Error("boom"));
    },
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(bigTwoClusterChunk()); // resolves, no unhandled rejection
  await flush();
  assert.equal(tr, 2);
  assert.equal(p.status().segmentsDone, 0);
});

test("pipeline: {disable:true} latches transcription off but keeps uploading", async () => {
  const seen = [];
  const { deps } = makeDeps({
    autoUpload: (path) => {
      seen.push(path);
      return Promise.resolve();
    },
    autoTranscribe: () => Promise.resolve({ ok: false, disable: true }),
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(bigTwoClusterChunk());
  await flush();
  await p.push(bigTwoClusterChunk());
  await flush();
  // both segments uploaded, transcribe never called again after disable.
  assert.equal(seen.length, 2);
  assert.equal(p.status().segmentsDone, 0);
});

test("pipeline: transcribe is only called once after disable latches", async () => {
  let tr = 0;
  const { deps } = makeDeps({
    autoUpload: () => Promise.resolve(),
    autoTranscribe: () => {
      tr += 1;
      return Promise.resolve({ ok: false, disable: true });
    },
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(bigTwoClusterChunk());
  await flush();
  await p.push(bigTwoClusterChunk());
  await flush();
  assert.equal(tr, 1, "disabled transcription never called again (no retry either)");
});

test("pipeline: flushFinal goes finalizing then ready when the tail completes", async () => {
  const { deps, statuses } = makeDeps({
    autoUpload: () => Promise.resolve(),
    autoTranscribe: () => Promise.resolve({ ok: true }),
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(smallTwoClusterChunk()); // buffered, below cut threshold (no cut)
  assert.equal(p.status().segmentsTotal, 0);
  await p.flushFinal();
  assert.ok(statuses.some((s) => s.state === "finalizing"), "finalizing fired");
  assert.equal(p.status().state, "ready");
  assert.equal(p.status().segmentsTotal, 1);
  assert.equal(p.status().segmentsDone, 1);
});

test("pipeline: flushFinal is failed when the tail segment cannot transcribe", async () => {
  const { deps } = makeDeps({
    autoUpload: () => Promise.resolve(),
    autoTranscribe: () => Promise.resolve({ ok: false }),
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(smallTwoClusterChunk());
  await p.flushFinal();
  assert.equal(p.status().state, "failed");
});

test("pipeline: earlier abandoned segment does not fail a good final tail", async () => {
  let n = 0;
  const { deps } = makeDeps({
    autoUpload: () => Promise.resolve(),
    // first segment (seq 0) fails both tries; later segments succeed.
    autoTranscribe: (seq) => {
      n += 1;
      return Promise.resolve({ ok: seq !== 0 });
    },
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(bigTwoClusterChunk()); // seg-0 fails
  await flush();
  await p.flushFinal(); // final tail succeeds
  assert.equal(p.status().state, "ready");
});

test("pipeline: flushFinal is failed when transcription was disabled", async () => {
  const { deps } = makeDeps({
    autoUpload: () => Promise.resolve(),
    autoTranscribe: () => Promise.resolve({ ok: false, disable: true }),
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(bigTwoClusterChunk());
  await flush();
  await p.flushFinal();
  assert.equal(p.status().state, "failed");
});

test("pipeline: flushFinal with no cluster ever seen is failed and calls no deps", async () => {
  const { deps, calls } = makeDeps();
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(makeBuffer(64, [])); // never a cluster
  await p.flushFinal();
  assert.equal(p.status().state, "failed");
  assert.deepEqual(calls, []);
});

test("pipeline: flushFinal is idempotent", async () => {
  let up = 0;
  const { deps } = makeDeps({
    autoUpload: () => {
      up += 1;
      return Promise.resolve();
    },
    autoTranscribe: () => Promise.resolve({ ok: true }),
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(smallTwoClusterChunk());
  await p.flushFinal();
  const doneUploads = up;
  await p.flushFinal(); // no dup work
  assert.equal(up, doneUploads);
  assert.equal(p.status().state, "ready");
});

test("pipeline: flushFinal on an off lane stays off and calls no deps", async () => {
  const { deps, calls } = makeDeps();
  const p = createSegmentPipeline("m1", "audio/ogg", deps);
  await p.flushFinal();
  assert.equal(p.status().state, "off");
  assert.deepEqual(calls, []);
});

test("pipeline: onStatus receives a fresh object on every transition", async () => {
  const { deps, statuses } = makeDeps({
    autoUpload: () => Promise.resolve(),
    autoTranscribe: () => Promise.resolve({ ok: true }),
  });
  const p = createSegmentPipeline("m1", "audio/webm", deps);
  await p.push(bigTwoClusterChunk()); // segmentsTotal 0->1
  await flush(); // segmentsDone 0->1
  assert.ok(statuses.length >= 2);
  // distinct object identities, not a mutated singleton.
  assert.notEqual(statuses[0], statuses[1]);
  assert.ok(statuses.some((s) => s.segmentsTotal === 1));
  assert.ok(statuses.some((s) => s.segmentsDone === 1));
});
