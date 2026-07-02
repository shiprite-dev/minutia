import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { QueryClient } from "@tanstack/react-query";

// Bundle the pure optimistic modules so node:test can exercise them (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-optimistic-"));

async function load(entry, name) {
  const outfile = path.join(tempDir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    absWorkingDir: root,
    external: ["@tanstack/react-query"],
  });
  return import(pathToFileURL(outfile).href);
}

const { applyOptimistic, patch } = await load("src/lib/optimistic.ts", "optimistic");
const {
  markRead,
  markAllRead,
  patchSeriesFields,
  appendDecision,
  removeIssue,
  isListCache,
} = await load("src/lib/optimistic-updates.ts", "updates");
const {
  isPendingDelete,
  beginPendingDelete,
  undoPendingDelete,
  markCommitting,
  clearPendingDelete,
} = await load("src/lib/pending-delete.ts", "pending");

// ---------------------------------------------------------------------------
// Pure updaters
// ---------------------------------------------------------------------------
test("markRead flips only the matching notification's read flag", () => {
  const list = [
    { id: "n1", read: false },
    { id: "n2", read: false },
  ];
  const next = markRead("n1")(list);
  assert.equal(next[0].read, true);
  assert.equal(next[1].read, false);
  assert.notEqual(next, list); // new array (immutability)
});

test("markAllRead sets every notification read", () => {
  const next = markAllRead()([{ id: "n1", read: false }, { id: "n2", read: false }]);
  assert.ok(next.every((n) => n.read === true));
});

test("patchSeriesFields merges fields on the matching series only", () => {
  const next = patchSeriesFields("s1", { name: "Renamed" })([
    { id: "s1", name: "Old" },
    { id: "s2", name: "Keep" },
  ]);
  assert.equal(next[0].name, "Renamed");
  assert.equal(next[1].name, "Keep");
});

test("appendDecision prepends the optimistic decision", () => {
  const next = appendDecision({ id: "temp-1", content: "new" })([{ id: "d0" }]);
  assert.equal(next.length, 2);
  assert.equal(next[0].id, "temp-1");
});

test("removeIssue filters the id out of a list", () => {
  const next = removeIssue("i1")([{ id: "i1" }, { id: "i2" }]);
  assert.deepEqual(next.map((i) => i.id), ["i2"]);
});

test("isListCache is true for array data, false for detail objects/undefined", () => {
  assert.equal(isListCache({ state: { data: [] } }), true);
  assert.equal(isListCache({ state: { data: { id: "x" } } }), false);
  assert.equal(isListCache({ state: { data: undefined } }), false);
});

// ---------------------------------------------------------------------------
// applyOptimistic (against a real QueryClient)
// ---------------------------------------------------------------------------
test("applyOptimistic applies patches and rollback restores the snapshot", async () => {
  const qc = new QueryClient();
  qc.setQueryData(["issues", "s1"], [{ id: "i1", priority: "low" }]);

  const { rollback } = await applyOptimistic(qc, [
    patch(["issues", "s1"], (old) => old.map((i) => ({ ...i, priority: "high" }))),
  ]);
  assert.equal(qc.getQueryData(["issues", "s1"])[0].priority, "high");

  rollback();
  assert.equal(qc.getQueryData(["issues", "s1"])[0].priority, "low");
});

test("applyOptimistic skips undefined caches (no crash on empty)", async () => {
  const qc = new QueryClient();
  const { rollback } = await applyOptimistic(qc, [
    patch(["notifications", "unread-count"], (n) => Math.max(0, n - 1)),
  ]);
  assert.equal(qc.getQueryData(["notifications", "unread-count"]), undefined);
  rollback(); // no-op, must not throw
});

test("applyOptimistic with a list predicate leaves detail caches untouched", async () => {
  const qc = new QueryClient();
  qc.setQueryData(["issues", "s1"], [{ id: "i1" }, { id: "i2" }]); // list
  qc.setQueryData(["issues", "detail", "i1"], { id: "i1", title: "keep" }); // detail

  await applyOptimistic(qc, [
    { filter: { queryKey: ["issues"], predicate: isListCache }, update: removeIssue("i1") },
  ]);

  assert.deepEqual(qc.getQueryData(["issues", "s1"]).map((i) => i.id), ["i2"]);
  assert.deepEqual(qc.getQueryData(["issues", "detail", "i1"]), { id: "i1", title: "keep" });
});

// ---------------------------------------------------------------------------
// pending-delete registry
// ---------------------------------------------------------------------------
test("begin then undo (waiting phase) cancels the delete", () => {
  beginPendingDelete("i1");
  assert.equal(isPendingDelete("i1"), true);
  assert.equal(undoPendingDelete("i1"), true);
  assert.equal(isPendingDelete("i1"), false);
});

test("undo after committing returns false (too late)", () => {
  beginPendingDelete("i2");
  markCommitting("i2");
  assert.equal(undoPendingDelete("i2"), false);
  assert.equal(isPendingDelete("i2"), true); // still committing
  clearPendingDelete("i2");
  assert.equal(isPendingDelete("i2"), false);
});

test("undo on an unknown id is a safe no-op", () => {
  assert.equal(undoPendingDelete("nope"), false);
});
