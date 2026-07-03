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

const { formatSseFrame, parseSseFrame, SSE_DONE, SSE_HEARTBEAT } = await bundle(
  "src/lib/summary/sse.ts", "sse"
);
const { splitWords, materializeClassName } = await bundle("src/lib/summary/flow.ts", "flow");

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

test("splitWords keeps trailing whitespace with each word and gives stable index keys", () => {
  const words = splitWords("Hello world");
  assert.deepEqual(words, [
    { key: 0, text: "Hello " },
    { key: 1, text: "world" },
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
