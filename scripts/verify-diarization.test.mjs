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
  entryPoints: ["src/lib/transcription/diarization.ts"],
  outfile: bundled, bundle: true, platform: "node", format: "esm",
  logLevel: "silent", absWorkingDir: root,
});
const { resolveSpeakerMap, flattenSegments } = await import(pathToFileURL(bundled).href);

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

test("more speakers than attendees leaves the extras unresolved, never invents", () => {
  const segments = [seg("A", "one"), seg("B", "two", 2), seg("C", "three", 4)];
  const { map } = resolveSpeakerMap(segments, ["Sarah Lee"]);
  assert.equal(Object.values(map).filter((v) => v === "Sarah Lee").length <= 1, true);
  assert.equal(map.C, null);
});

test("priorMap seeds a stable assignment across meetings", () => {
  const { map } = resolveSpeakerMap([seg("A", "no cues")], ["Sarah Lee", "Mike Ross"], { A: "Mike Ross" });
  assert.equal(map.A, "Mike Ross");
});

test("flattenSegments renders mapped names and merges consecutive turns", () => {
  const segments = [seg("A", "First."), seg("A", "Still me.", 2), seg("B", "My turn.", 4)];
  const out = flattenSegments(segments, { A: "Sarah Lee", B: null });
  assert.equal(out, "Sarah Lee: First. Still me.\nSpeaker B: My turn.");
});

test("empty segments flatten to empty string", () => {
  assert.equal(flattenSegments([], {}), "");
});
