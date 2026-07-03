import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-word-pacer-"));
const bundled = path.join(tempDir, "word-pacer.mjs");
await esbuild.build({
  entryPoints: ["src/lib/ai/word-pacer.ts"], outfile: bundled, bundle: true,
  platform: "node", format: "esm", logLevel: "silent", absWorkingDir: root,
});
const { paceWords } = await import(pathToFileURL(bundled).href);

async function* scripted(deltas) {
  for (const d of deltas) yield d;
}
const noSleep = async () => {};

async function collect(gen) {
  const out = [];
  for await (const w of gen) out.push(w);
  return out;
}

test("regroups jittered deltas into whole words at whitespace boundaries", async () => {
  const words = await collect(
    paceWords(scripted(["Hel", "lo wor", "ld", " done"]), { sleep: noSleep })
  );
  assert.deepEqual(words, ["Hello ", "world ", "done"]);
});

test("loses no characters: concatenation equals the input concatenation", async () => {
  const input = ["The quick ", "brown", " fox ", "jumps."];
  const words = await collect(paceWords(scripted(input), { sleep: noSleep }));
  assert.equal(words.join(""), input.join(""));
});

test("emits a trailing partial word with no following whitespace", async () => {
  const words = await collect(paceWords(scripted(["one two thr"]), { sleep: noSleep }));
  assert.deepEqual(words, ["one ", "two ", "thr"]);
});

test("empty stream yields nothing", async () => {
  assert.deepEqual(await collect(paceWords(scripted([]), { sleep: noSleep })), []);
});

test("waits at least minIntervalMs between emitted words", async () => {
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); };
  await collect(paceWords(scripted(["a b c "]), { minIntervalMs: 18, sleep }));
  // Two gaps between three words; each pause is the configured minimum.
  assert.equal(waits.length >= 2, true);
  assert.equal(waits.every((w) => w === 18), true);
});
