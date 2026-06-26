import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure poll-state module so node:test can exercise it without
// needing a browser or the Next.js runtime (same esbuild-bundle pattern used
// across the project's verify-* tests).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-upgrade-poll-"));
const bundled = path.join(tempDir, "upgrade-poll-state.mjs");

await esbuild.build({
  entryPoints: ["src/lib/billing/upgrade-poll-state.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});

const { nextPollState } = await import(pathToFileURL(bundled).href);

// ---- nextPollState ----------------------------------------------------------

test("returns done immediately when hasAccess is true, regardless of attempts", () => {
  assert.equal(nextPollState(0, true, 22), "done");
  assert.equal(nextPollState(1, true, 22), "done");
  assert.equal(nextPollState(22, true, 22), "done");
  assert.equal(nextPollState(50, true, 22), "done");
});

test("returns finalizing while attempts < maxAttempts and access not yet granted", () => {
  // Component increments attemptsRef before calling nextPollState, so the
  // real call sequence starts at 1, never 0.
  assert.equal(nextPollState(1, false, 22), "finalizing");
  assert.equal(nextPollState(10, false, 22), "finalizing");
  assert.equal(nextPollState(21, false, 22), "finalizing");
});

test("returns timeout when attempts >= maxAttempts with no access", () => {
  assert.equal(nextPollState(22, false, 22), "timeout");
  assert.equal(nextPollState(30, false, 22), "timeout");
  assert.equal(nextPollState(100, false, 22), "timeout");
});

test("done takes priority over timeout when access arrives on the last poll", () => {
  // attempts === maxAttempts but hasAccess is true: done wins
  assert.equal(nextPollState(22, true, 22), "done");
});

test("maxAttempts of 1: first real attempt (attempt=1) immediately times out", () => {
  // With maxAttempts=1 the component's first call is nextPollState(1, false, 1),
  // which is already at the cap — no finalizing phase exists.
  assert.equal(nextPollState(1, false, 1), "timeout");
});

test("maxAttempts of 0: any call with no access is immediately timeout", () => {
  assert.equal(nextPollState(0, false, 0), "timeout");
});

test("phase transitions are deterministic across a full 22-attempt sequence", () => {
  // Real call sequence: attempts 1..25 (component increments before calling).
  const phases = Array.from({ length: 25 }, (_, i) =>
    nextPollState(i + 1, false, 22)
  );
  // attempts 1..21 are finalizing, from 22 onward timeout
  const finalizingCount = phases.filter((p) => p === "finalizing").length;
  const timeoutCount = phases.filter((p) => p === "timeout").length;
  assert.equal(finalizingCount, 21); // attempts 1..21
  assert.equal(timeoutCount, 4);     // attempts 22..25
});
