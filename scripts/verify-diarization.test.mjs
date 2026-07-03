import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-diarization-"));
const bundled = path.join(tempDir, "diarization.mjs");
await esbuild.build({
  entryPoints: ["src/lib/transcription/index.ts"],
  outfile: bundled, bundle: true, platform: "node", format: "esm",
  logLevel: "silent", absWorkingDir: root,
});
const { resolveSpeakerMap, flattenSegments, assembleDiarizedTranscript } = await import(pathToFileURL(bundled).href);

const seg = (speaker, text, start = 0) => ({ speaker, text, start, end: start + 2, confidence: 0.9 });

test("self-introduction maps a speaker to the matching attendee", () => {
  const segments = [seg("A", "Hi everyone, this is Sarah."), seg("B", "Morning.", 2)];
  const { map, proposals } = resolveSpeakerMap(segments, ["Sarah Lee", "Mike Ross"]);
  assert.equal(map.A, "Sarah Lee");
  assert.equal(proposals.find((p) => p.speaker === "A").reason, "self_intro");
});

test("single attendee resolves the only speaker with low confidence", () => {
  const { map, proposals } = resolveSpeakerMap([seg("A", "just me here")], ["Sarah Lee"]);
  assert.equal(map.A, "Sarah Lee");
  assert.equal(proposals[0].reason, "roster_single");
});

test("more speakers than attendees resolves none via fallback and never invents", () => {
  const segments = [seg("A", "one"), seg("B", "two", 2), seg("C", "three", 4)];
  const { map } = resolveSpeakerMap(segments, ["Sarah Lee"]);
  assert.equal(Object.values(map).filter((v) => v === "Sarah Lee").length <= 1, true);
  assert.equal(map.C, null);
});

test("priorMap seeds a stable assignment across meetings", () => {
  const { map, proposals } = resolveSpeakerMap([seg("A", "no cues")], ["Sarah Lee", "Mike Ross"], { A: "Mike Ross" });
  assert.equal(map.A, "Mike Ross");
  assert.equal(proposals.find((p) => p.speaker === "A").reason, "prior_map");
});

test("composed priority: self-intro then single-attendee fallback resolves both", () => {
  const segments = [seg("A", "Hi, this is Sarah."), seg("B", "No cues here.", 2)];
  const { map, proposals } = resolveSpeakerMap(segments, ["Sarah Lee", "Mike Ross"]);
  assert.equal(map.A, "Sarah Lee");
  assert.equal(map.B, "Mike Ross");
  assert.equal(proposals.find((p) => p.speaker === "B").reason, "roster_single");
});

test("non-alphabetic speaker label renders as-is", () => {
  const out = flattenSegments([seg("SPEAKER_00", "hello")], {});
  assert.equal(out, "Speaker SPEAKER_00: hello");
});

test("flattenSegments renders mapped names and merges consecutive turns", () => {
  const segments = [seg("A", "First."), seg("A", "Still me.", 2), seg("B", "My turn.", 4)];
  const out = flattenSegments(segments, { A: "Sarah Lee", B: null });
  assert.equal(out, "Sarah Lee: First. Still me.\nSpeaker B: My turn.");
});

test("empty segments flatten to empty string", () => {
  assert.equal(flattenSegments([], {}), "");
});

test("assembleDiarizedTranscript resolves speakers and attributes transcript_raw", () => {
  const segments = [
    { speaker: "A", start: 0, end: 2, text: "Hi this is Sarah.", confidence: 0.9 },
    { speaker: "B", start: 2, end: 4, text: "I'll take the deploy.", confidence: 0.9 },
  ];
  const out = assembleDiarizedTranscript(segments, ["Sarah Lee", "Mike Ross"]);
  assert.equal(out.transcriptDiarized, true);
  assert.equal(out.speakerMap.A, "Sarah Lee");
  assert.match(out.transcriptRaw, /^Sarah Lee: Hi this is Sarah\./);
  assert.equal(out.segments.length, 2);
});

test("re-flatten after a speaker correction updates the attributed transcript", () => {
  const segments = [{ speaker: "A", start: 0, end: 2, text: "Hello.", confidence: 0.9 }];
  const corrected = { A: "Mike Ross" };
  assert.equal(flattenSegments(segments, corrected), "Mike Ross: Hello.");
});
