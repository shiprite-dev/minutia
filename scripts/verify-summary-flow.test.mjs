import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-summary-flow-"));

async function bundle(entry, name) {
  const outfile = path.join(tempDir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [entry], outfile, bundle: true, platform: "node",
    format: "esm", logLevel: "silent", absWorkingDir: root,
  });
  return import(pathToFileURL(outfile).href);
}

const { formatSseFrame, formatSseMeta, parseSseFrame, SSE_DONE, SSE_HEARTBEAT } = await bundle(
  "src/lib/summary/sse.ts", "sse"
);
const { splitWords, materializeClassName, formatProvenance } = await bundle("src/lib/summary/flow.ts", "flow");

test("formatSseFrame encodes a word as a single SSE data frame", () => {
  assert.equal(formatSseFrame("Hello "), 'data: {"t":"Hello "}\n\n');
});

test("formatSseFrame escapes quotes and newlines safely", () => {
  const round = JSON.parse(formatSseFrame('a "b"').slice(6));
  assert.equal(round.t, 'a "b"');
});

test("parseSseFrame reads a word, the done sentinel, and ignores heartbeat", () => {
  assert.deepEqual(parseSseFrame('data: {"t":"Hi "}'), { word: "Hi " });
  assert.deepEqual(parseSseFrame(SSE_DONE.trim()), { done: true });
  assert.deepEqual(parseSseFrame(SSE_HEARTBEAT.trim()), {});
  assert.deepEqual(parseSseFrame(""), {});
  assert.deepEqual(parseSseFrame("data: not-json"), {});
});

test("formatSseMeta encodes the model as a single meta frame parseFrame decodes", () => {
  assert.equal(formatSseMeta("gemini-3.1-flash"), 'data: {"m":"gemini-3.1-flash"}\n\n');
  assert.deepEqual(parseSseFrame('data: {"m":"gemini-3.1-flash"}'), { model: "gemini-3.1-flash" });
});

test("formatSseMeta of an empty model produces no frame; parse ignores empty meta", () => {
  assert.equal(formatSseMeta(""), "");
  assert.deepEqual(parseSseFrame('data: {"m":""}'), {});
});

test("splitWords keeps trailing whitespace with each word and gives stable index keys", () => {
  const words = splitWords("Hello world");
  assert.deepEqual(words, [
    { key: 0, text: "Hello ", bold: false },
    { key: 1, text: "world", bold: false },
  ]);
});

test("splitWords is append-stable: a growing stream keeps earlier keys and text", () => {
  const a = splitWords("Hello ");
  const b = splitWords("Hello world");
  assert.equal(b[0].key, a[0].key);
  assert.equal(b[0].text, a[0].text);
});

test("splitWords of empty text is empty", () => {
  assert.deepEqual(splitWords(""), []);
});

test("splitWords marks a **bold** phrase and strips the markers", () => {
  const words = splitWords("a **bold** c");
  assert.deepEqual(words, [
    { key: 0, text: "a ", bold: false },
    { key: 1, text: "bold ", bold: true },
    { key: 2, text: "c", bold: false },
  ]);
});

test("splitWords bolds every word of a multi-word phrase", () => {
  const words = splitWords("**migration review** owner");
  assert.deepEqual(words.map((w) => w.bold), [true, true, false]);
  assert.equal(words.map((w) => w.text).join(""), "migration review owner");
});

test("splitWords never injects raw markup and ignores an unterminated opener", () => {
  // Mid-stream a lone opener has not closed yet: no bold, no literal ** leaks.
  const words = splitWords("owns the **mig");
  assert.equal(words.some((w) => w.bold), false);
  assert.equal(words.map((w) => w.text).join(""), "owns the mig");
});

test("splitWords stays append-stable across a bold phrase closing mid-stream", () => {
  const partial = splitWords("I will **take");
  const closed = splitWords("I will **take** it");
  assert.equal(closed[0].key, partial[0].key);
  assert.equal(closed[1].text, partial[1].text);
  assert.equal(closed[2].bold, true);
});

test("formatProvenance renders first-word and total timings to one decimal", () => {
  assert.equal(
    formatProvenance({ firstWordMs: 640, totalMs: 2100 }),
    "first words in 0.6s · 2.1s total"
  );
});

test("formatProvenance omits a missing timing gracefully", () => {
  assert.equal(formatProvenance({ firstWordMs: null, totalMs: 1500 }), "1.5s total");
  assert.equal(formatProvenance({ firstWordMs: 900, totalMs: null }), "first words in 0.9s");
  assert.equal(formatProvenance({ firstWordMs: null, totalMs: null }), "");
});

test("materializeClassName drops the class when reduced motion is requested", () => {
  assert.equal(materializeClassName(false), "materialize");
  assert.equal(materializeClassName(true), "");
});

const { SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } = await bundle(
  "src/lib/summary/prompt.ts", "prompt"
);

test("summary system prompt asks for prose, never JSON", () => {
  assert.match(SUMMARY_SYSTEM_PROMPT, /prose|paragraph/i);
  assert.doesNotMatch(SUMMARY_SYSTEM_PROMPT, /JSON/i);
});

test("buildSummaryPrompt embeds the meeting context and the transcript", () => {
  const prompt = buildSummaryPrompt({
    title: "Weekly Sync",
    seriesName: "Platform",
    attendees: ["Sarah Lee", "Mike Ross"],
    transcript: "Mike Ross: I will take the migration review.",
  });
  assert.match(prompt, /Platform/);
  assert.match(prompt, /Weekly Sync/);
  assert.match(prompt, /Sarah Lee, Mike Ross/);
  assert.match(prompt, /migration review/);
});
