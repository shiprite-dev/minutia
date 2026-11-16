// Contract: src/lib/transcription/device.ts exports DEVICE_TRANSCRIPT_MAX_BYTES (2 * 1024 * 1024), parseDeviceTranscript(body: unknown) => { ok: true, value } | { ok: false, fields: string[] }, assembleDeviceTranscript(value, { recorderName, priorSpeakerMap }) => { segments, speakerMap, transcriptRaw, outcome }.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "minutia-device-transcript-"),
);

async function load(entry, name) {
  const outfile = path.join(tempDir, `${name}.mjs`);
  try {
    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
      absWorkingDir: root,
    });
  } catch (error) {
    return { __buildError: error.errors?.[0]?.text ?? String(error) };
  }
  return import(pathToFileURL(outfile).href);
}

const device = await load("src/lib/transcription/device.ts", "device");

function fn(name) {
  assert.equal(
    device.__buildError,
    undefined,
    `src/lib/transcription/device.ts failed to build: ${device.__buildError}`,
  );
  assert.equal(typeof device[name], "function", `${name} must be exported`);
  return device[name];
}

const source = () => ({
  kind: "device",
  engine: "fluidaudio",
  engine_version: "0.17.7",
  model: "parakeet-tdt-0.6b-v3-coreml",
  model_revision: "a0cd34f8",
  app_version: "0.4.0",
  compute: "ane",
});

const seg = (speaker, start, end, text, confidence = 0.9) => ({
  speaker,
  start,
  end,
  text,
  confidence,
});

function body(overrides = {}) {
  return {
    schema_version: 1,
    source: source(),
    language: "en",
    duration_seconds: 1834.2,
    outcome: "speech",
    segments: [
      seg("me", 0.42, 3.1, "Let us start with the open items.", 0.93),
      seg("them", 3.4, 7.9, "The vendor contract is still blocked."),
    ],
    ...overrides,
  };
}

function parsed(input) {
  const result = fn("parseDeviceTranscript")(input);
  assert.equal(
    result.ok,
    true,
    `expected a valid body, got fields ${JSON.stringify(result.fields)}`,
  );
  return result.value;
}

function rejected(input, field) {
  const result = fn("parseDeviceTranscript")(input);
  assert.equal(result.ok, false, "expected the body to be rejected");
  assert.ok(
    Array.isArray(result.fields) && result.fields.length > 0,
    "a rejection lists field paths",
  );
  for (const f of result.fields) assert.equal(typeof f, "string");
  if (field !== undefined) {
    assert.ok(
      result.fields.includes(field),
      `expected fields to include "${field}", got ${JSON.stringify(result.fields)}`,
    );
  }
  return result;
}

function assemble(input, options = {}) {
  return fn("assembleDeviceTranscript")(parsed(input), {
    recorderName: "Ada Lovelace",
    priorSpeakerMap: null,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test("the 2 MB body cap is exported for the route", () => {
  assert.equal(
    device.__buildError,
    undefined,
    `device.ts failed to build: ${device.__buildError}`,
  );
  assert.equal(device.DEVICE_TRANSCRIPT_MAX_BYTES, 2 * 1024 * 1024);
});

test("the documented request body is accepted", () => {
  const value = parsed(body());
  assert.equal(value.language, "en");
  assert.equal(value.outcome, "speech");
  assert.equal(value.segments.length, 2);
  assert.deepEqual(value.source, source());
});

test("schema_version must be 1", () => {
  rejected(body({ schema_version: 2 }), "schema_version");
  rejected({ ...body(), schema_version: undefined }, "schema_version");
});

test("unknown keys are rejected at every level and reported by their path", () => {
  rejected(body({ extra: true }), "extra");
  rejected(body({ source: { ...source(), extra: "x" } }), "source.extra");
  rejected(
    body({ segments: [{ ...seg("me", 0, 1, "hello there"), words: [] }] }),
    "segments.0.words",
  );
});

test("there is no client-supplied full-text field", () => {
  rejected(body({ transcript_raw: "Ada: anything" }), "transcript_raw");
  rejected(body({ text: "anything" }), "text");
});

test("source.kind is device and compute is ane, gpu or cpu", () => {
  rejected(body({ source: { ...source(), kind: "cloud" } }), "source.kind");
  rejected(body({ source: { ...source(), compute: "tpu" } }), "source.compute");
  for (const compute of ["ane", "gpu", "cpu"])
    parsed(body({ source: { ...source(), compute } }));
});

test("source.model is a free string so a new model needs no server change", () => {
  const value = parsed(
    body({
      source: {
        ...source(),
        model: "parakeet-tdt-ultra-coreml",
        model_revision: "ffff0001",
      },
    }),
  );
  assert.equal(value.source.model, "parakeet-tdt-ultra-coreml");
});

test("source strings are at most 100 characters", () => {
  parsed(body({ source: { ...source(), engine: "e".repeat(100) } }));
  rejected(
    body({ source: { ...source(), engine: "e".repeat(101) } }),
    "source.engine",
  );
  rejected(
    body({ source: { ...source(), model: "m".repeat(101) } }),
    "source.model",
  );
});

test("language is a lowercase ISO 639-1 code", () => {
  parsed(body({ language: "de" }));
  rejected(body({ language: "EN" }), "language");
  rejected(body({ language: "eng" }), "language");
  rejected(body({ language: "en-US" }), "language");
});

test("duration_seconds is finite, above 0 and at most 21600", () => {
  parsed(body({ duration_seconds: 21600 }));
  for (const bad of [
    0,
    -1,
    21600.5,
    Number.POSITIVE_INFINITY,
    Number.NaN,
    "60",
  ]) {
    rejected(body({ duration_seconds: bad }), "duration_seconds");
  }
});

test("speaker labels are me, them or them-N with N from 1 to 99", () => {
  for (const speaker of [
    "me",
    "them",
    "them-1",
    "them-9",
    "them-42",
    "them-99",
  ]) {
    parsed(body({ segments: [seg(speaker, 0, 1, "hello there")] }));
  }
  for (const speaker of [
    "Me",
    "THEM",
    "you",
    "them-0",
    "them-01",
    "them-100",
    "them-",
    "A",
    "",
  ]) {
    rejected(
      body({ segments: [seg(speaker, 0, 1, "hello there")] }),
      "segments.0.speaker",
    );
  }
});

test("segment times are finite and ordered within the meeting window", () => {
  rejected(
    body({ segments: [seg("me", Number.NaN, 1, "hello")] }),
    "segments.0.start",
  );
  rejected(
    body({ segments: [seg("me", 0, Number.POSITIVE_INFINITY, "hello")] }),
    "segments.0.end",
  );
  rejected(
    body({ segments: [seg("me", -0.1, 1, "hello")] }),
    "segments.0.start",
  );
  rejected(body({ segments: [seg("me", 5, 4.9, "hello")] }), "segments.0.end");
  rejected(
    body({ duration_seconds: 60, segments: [seg("me", 60, 65.01, "hello")] }),
    "segments.0.end",
  );
  parsed(
    body({ duration_seconds: 60, segments: [seg("me", 60, 65, "hello")] }),
  );
  parsed(body({ segments: [seg("me", 2, 2, "hello")] }));
});

test("segment text is 1 to 2000 characters", () => {
  parsed(body({ segments: [seg("me", 0, 1, "x".repeat(2000))] }));
  rejected(
    body({ segments: [seg("me", 0, 1, "x".repeat(2001))] }),
    "segments.0.text",
  );
  rejected(body({ segments: [seg("me", 0, 1, "")] }), "segments.0.text");
});

test("confidence is null, omitted, or between 0 and 1", () => {
  parsed(body({ segments: [seg("me", 0, 1, "hello", null)] }));
  parsed(
    body({ segments: [{ speaker: "me", start: 0, end: 1, text: "hello" }] }),
  );
  parsed(body({ segments: [seg("me", 0, 1, "hello", 0)] }));
  parsed(body({ segments: [seg("me", 0, 1, "hello", 1)] }));
  rejected(
    body({ segments: [seg("me", 0, 1, "hello", 1.01)] }),
    "segments.0.confidence",
  );
  rejected(
    body({ segments: [seg("me", 0, 1, "hello", -0.01)] }),
    "segments.0.confidence",
  );
});

test("at most 20000 segments", () => {
  const many = (n) =>
    Array.from({ length: n }, (_, i) => seg(i % 2 ? "them" : "me", 0, 0, "ok"));
  parsed(body({ duration_seconds: 21600, segments: many(20000) }));
  rejected(
    body({ duration_seconds: 21600, segments: many(20001) }),
    "segments",
  );
});

test("total segment text is at most 600000 characters", () => {
  const big = (n) =>
    Array.from({ length: n }, (_, i) => seg("me", i, i + 1, "y".repeat(2000)));
  parsed(body({ duration_seconds: 21600, segments: big(300) }));
  rejected(
    body({
      duration_seconds: 21600,
      segments: [...big(300), seg("them", 400, 401, "z")],
    }),
    "segments",
  );
});

test("outcome speech needs at least one segment with text", () => {
  rejected(body({ outcome: "speech", segments: [] }), "segments");
  rejected(
    body({
      outcome: "speech",
      segments: [seg("me", 0, 1, "   "), seg("them", 1, 2, "\u0007")],
    }),
    "segments",
  );
});

test("outcome no_speech requires zero segments", () => {
  const value = parsed(body({ outcome: "no_speech", segments: [] }));
  assert.equal(value.outcome, "no_speech");
  rejected(
    body({ outcome: "no_speech", segments: [seg("me", 0, 1, "hello")] }),
    "segments",
  );
  rejected(body({ outcome: "silence", segments: [] }), "outcome");
});

test("non-object bodies are rejected", () => {
  for (const bad of [null, undefined, "text", 42, []]) rejected(bad);
});

test("a rejection never echoes transcript content", () => {
  const secret = "the acquisition closes on friday";
  const result = rejected(
    body({ segments: [seg("Boss", 0, 1, secret)] }),
    "segments.0.speaker",
  );
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual(Object.keys(result).sort(), ["fields", "ok"]);
});

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

test("segments are sorted by start time and carry exactly the stored shape", () => {
  const { segments } = assemble(
    body({
      segments: [
        seg("them", 3.4, 7.9, "The vendor contract is still blocked.", 0.9),
        seg("me", 0.42, 3.1, "Let us start with the open items.", 0.93),
        { speaker: "me", start: 8.2, end: 9, text: "Noted." },
      ],
    }),
  );
  assert.deepEqual(segments, [
    {
      speaker: "me",
      start: 0.42,
      end: 3.1,
      text: "Let us start with the open items.",
      confidence: 0.93,
    },
    {
      speaker: "them",
      start: 3.4,
      end: 7.9,
      text: "The vendor contract is still blocked.",
      confidence: 0.9,
    },
    { speaker: "me", start: 8.2, end: 9, text: "Noted.", confidence: null },
  ]);
});

test("control characters are stripped, line breaks become spaces, text is trimmed", () => {
  const { segments } = assemble(
    body({
      segments: [
        seg("me", 0, 1, "  Ship\u0000 it\u0007 now\u007f  "),
        seg("them", 2, 3, "line one\nline two\r\n\tdone"),
      ],
    }),
  );
  assert.equal(segments[0].text, "Ship it now");
  assert.equal(segments[1].text, "line one line two done");
  for (const s of segments)
    assert.doesNotMatch(s.text, /[\u0000-\u001f\u007f-\u009f]/);
});

test("segments that are empty after cleaning are dropped", () => {
  const { segments } = assemble(
    body({
      segments: [
        seg("me", 0, 1, "   "),
        seg("them", 1, 2, "\u0000\u0007"),
        seg("me", 2, 3, "Real words here"),
      ],
    }),
  );
  assert.deepEqual(
    segments.map((s) => s.text),
    ["Real words here"],
  );
});

test("a me segment that is the them audio echoed into the mic (80 ms later) is dropped", () => {
  const { segments } = assemble(
    body({
      segments: [
        seg("them", 3.4, 7.9, "The vendor contract is still blocked."),
        seg("me", 3.48, 7.98, "The vendor contract is still blocked.", 0.41),
        seg("me", 8.1, 9.5, "I will chase legal today."),
      ],
    }),
  );
  assert.deepEqual(
    segments.map((s) => [s.speaker, s.text]),
    [
      ["them", "The vendor contract is still blocked."],
      ["me", "I will chase legal today."],
    ],
  );
});

test("a me segment overlapping them with different words is kept", () => {
  const { segments } = assemble(
    body({
      segments: [
        seg("them", 3.4, 7.9, "The vendor contract is still blocked."),
        seg("me", 4, 6, "Sorry, can you repeat that?"),
      ],
    }),
  );
  assert.equal(segments.length, 2);
});

test("the speaker map names me after the recorder and leaves them unnamed", () => {
  const { speakerMap } = assemble(body());
  assert.deepEqual(speakerMap, { me: "Ada Lovelace", them: null });
});

test("a prior human correction wins over the recorder name", () => {
  const { speakerMap, transcriptRaw } = assemble(body(), {
    priorSpeakerMap: { me: "Grace Hopper", them: "Vendor Rep" },
  });
  assert.deepEqual(speakerMap, { me: "Grace Hopper", them: "Vendor Rep" });
  assert.equal(
    transcriptRaw,
    "Grace Hopper: Let us start with the open items.\nVendor Rep: The vendor contract is still blocked.",
  );
});

test("transcript_raw is flattened on the server, merging consecutive turns", () => {
  const { transcriptRaw, outcome } = assemble(
    body({
      segments: [
        seg("me", 0, 1, "First point."),
        seg("me", 1, 2, "Second point."),
        seg("them", 2, 3, "Agreed."),
      ],
    }),
  );
  assert.equal(
    transcriptRaw,
    "Ada Lovelace: First point. Second point.\nThem: Agreed.",
  );
  assert.equal(outcome, "speech");
});

test("no recorder name falls back to the Me label", () => {
  const { transcriptRaw, speakerMap } = assemble(body(), {
    recorderName: null,
  });
  assert.deepEqual(speakerMap, { me: null, them: null });
  assert.ok(transcriptRaw.startsWith("Me: "));
});

test("no_speech assembles to an empty transcript with outcome no_speech", () => {
  const result = assemble(body({ outcome: "no_speech", segments: [] }));
  assert.deepEqual(result.segments, []);
  assert.equal(result.transcriptRaw, "");
  assert.equal(result.outcome, "no_speech");
});
