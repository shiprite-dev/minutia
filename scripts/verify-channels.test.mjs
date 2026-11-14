import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// "Me versus Them" channel attribution: the companion uploads the microphone
// (me) and system audio (them) as two files per segment; the server transcribes
// each with timestamps and merges them into the existing diarized shape.
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-channels-"));

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

const channels = await load("src/lib/transcription/channels.ts", "channels");
const segments = await load("src/lib/audio/segments.ts", "segments");
const transcription = await load(
  "src/lib/transcription/index.ts",
  "transcription",
);

function fn(mod, name) {
  assert.equal(
    mod.__buildError,
    undefined,
    `module failed to build: ${mod.__buildError}`,
  );
  assert.equal(typeof mod[name], "function", `${name} must be exported`);
  return mod[name];
}

const timed = (start, end, text) => ({ start, end, text });
const input = (
  text,
  timedSegments,
  outcome = text.trim() ? "speech" : "no_speech",
  durationSeconds = 300,
) => ({
  text,
  durationSeconds,
  timed: timedSegments,
  outcome,
});

// ---------------------------------------------------------------------------
// Storage path + register body contract (shared with the desktop companion)
// ---------------------------------------------------------------------------

test("segmentChannelPath builds <meeting>/seg-<n>-<channel>.<ext>", () => {
  const segmentChannelPath = fn(segments, "segmentChannelPath");
  assert.equal(segmentChannelPath("m1", 3, "me", "m4a"), "m1/seg-3-me.m4a");
  assert.equal(segmentChannelPath("m1", 3, "them", "m4a"), "m1/seg-3-them.m4a");
});

test("parseChannelSegmentBody accepts the dual-channel register body", () => {
  const parse = fn(segments, "parseChannelSegmentBody");
  const out = parse("m1", 2, {
    paths: { me: "m1/seg-2-me.m4a", them: "m1/seg-2-them.m4a" },
    offset_seconds: 600,
  });
  assert.deepEqual(out, {
    mePath: "m1/seg-2-me.m4a",
    themPath: "m1/seg-2-them.m4a",
    ext: "m4a",
    offsetSeconds: 600,
  });
});

test("parseChannelSegmentBody allows a missing them channel (system audio unavailable)", () => {
  const parse = fn(segments, "parseChannelSegmentBody");
  const out = parse("m1", 0, {
    paths: { me: "m1/seg-0-me.m4a", them: null },
    offset_seconds: 0,
  });
  assert.deepEqual(out, {
    mePath: "m1/seg-0-me.m4a",
    themPath: null,
    ext: "m4a",
    offsetSeconds: 0,
  });
});

test("parseChannelSegmentBody returns null for a legacy single-path body so the route keeps the old path", () => {
  const parse = fn(segments, "parseChannelSegmentBody");
  assert.equal(parse("m1", 0, { path: "m1/seg-0.m4a" }), null);
  assert.equal(parse("m1", 0, undefined), null);
});

test("parseChannelSegmentBody rejects paths outside the meeting, wrong seq, mismatched ext, bad offset", () => {
  const parse = fn(segments, "parseChannelSegmentBody");
  const ok = { me: "m1/seg-1-me.m4a", them: "m1/seg-1-them.m4a" };
  assert.equal(
    parse("m1", 1, {
      paths: { ...ok, me: "m2/seg-1-me.m4a" },
      offset_seconds: 300,
    }),
    null,
  );
  assert.equal(
    parse("m1", 1, {
      paths: { ...ok, them: "m1/seg-2-them.m4a" },
      offset_seconds: 300,
    }),
    null,
  );
  assert.equal(
    parse("m1", 1, {
      paths: { ...ok, them: "m1/seg-1-them.webm" },
      offset_seconds: 300,
    }),
    null,
  );
  assert.equal(
    parse("m1", 1, {
      paths: { me: "m1/seg-1-them.m4a", them: null },
      offset_seconds: 300,
    }),
    null,
  );
  assert.equal(parse("m1", 1, { paths: ok, offset_seconds: -1 }), null);
  assert.equal(parse("m1", 1, { paths: ok, offset_seconds: "300" }), null);
  assert.equal(parse("m1", 1, { paths: ok }), null);
});

test("legacy parseSegmentPath still accepts the single mixed file", () => {
  const parseSegmentPath = fn(segments, "parseSegmentPath");
  assert.deepEqual(parseSegmentPath("m1", 0, "m1/seg-0.m4a"), { ext: "m4a" });
  assert.deepEqual(parseSegmentPath("m1", 0, "m1/seg-0.webm"), { ext: "webm" });
});

// ---------------------------------------------------------------------------
// Merge: interleave by timestamp, absolute offsets, coarse fallback
// ---------------------------------------------------------------------------

test("mergeChannels interleaves me and them by start time and applies the segment offset", () => {
  const merge = fn(channels, "mergeChannels");
  const out = merge({
    me: input("Morning. I'll take the deploy.", [
      timed(0, 1, "Morning."),
      timed(6, 8, "I'll take the deploy."),
    ]),
    them: input("Hi. Who owns the deploy?", [
      timed(1.5, 2, "Hi."),
      timed(3, 5, "Who owns the deploy?"),
    ]),
    offsetSeconds: 300,
  });
  assert.deepEqual(
    out.map((s) => [s.speaker, s.start, s.end, s.text]),
    [
      ["me", 300, 301, "Morning."],
      ["them", 301.5, 302, "Hi."],
      ["them", 303, 305, "Who owns the deploy?"],
      ["me", 306, 308, "I'll take the deploy."],
    ],
  );
  assert.ok(out.every((s) => s.confidence === null));
});

test("mergeChannels drops empty-text segments and trims text", () => {
  const merge = fn(channels, "mergeChannels");
  const out = merge({
    me: input(" ok ", [timed(0, 1, "  ok  "), timed(2, 3, "   ")]),
    them: input("", [], "no_speech"),
    offsetSeconds: 0,
  });
  assert.deepEqual(
    out.map((s) => [s.speaker, s.text]),
    [["me", "ok"]],
  );
});

test("mergeChannels without provider timestamps degrades to one block per channel spanning the segment", () => {
  const merge = fn(channels, "mergeChannels");
  const out = merge({
    me: input("I'll send the notes.", undefined, "speech", 120),
    them: input("Thanks, see you Friday.", undefined, "speech", 120),
    offsetSeconds: 600,
  });
  assert.deepEqual(
    out.map((s) => [s.speaker, s.start, s.end, s.text]),
    [
      ["me", 600, 720, "I'll send the notes."],
      ["them", 600, 720, "Thanks, see you Friday."],
    ],
  );
});

test("mergeChannels with a missing them channel yields only me lines (never invents the far side)", () => {
  const merge = fn(channels, "mergeChannels");
  const out = merge({
    me: input("Just me.", [timed(0, 1, "Just me.")]),
    them: null,
    offsetSeconds: 0,
  });
  assert.deepEqual(
    out.map((s) => s.speaker),
    ["me"],
  );
});

test("mergeChannels with a missing me channel yields only them lines", () => {
  const merge = fn(channels, "mergeChannels");
  const out = merge({
    me: null,
    them: input("Only them.", [timed(0, 1, "Only them.")]),
    offsetSeconds: 0,
  });
  assert.deepEqual(
    out.map((s) => s.speaker),
    ["them"],
  );
});

// ---------------------------------------------------------------------------
// Echo: laptop speakers leak the far side into the mic
// ---------------------------------------------------------------------------

test("isEcho flags a time-overlapping me segment whose words are contained in a them segment", () => {
  const isEcho = fn(channels, "isEcho");
  assert.equal(
    isEcho(
      timed(10.4, 13, "can you ship it by friday"),
      timed(10, 13, "Can you ship it by Friday?"),
    ),
    true,
  );
  assert.equal(
    isEcho(
      timed(10, 12, "ship it by friday"),
      timed(10, 14, "Can you ship it by Friday, please?"),
    ),
    true,
  );
});

test("isEcho keeps genuine me speech: different words, or same words far apart in time", () => {
  const isEcho = fn(channels, "isEcho");
  assert.equal(
    isEcho(
      timed(10, 13, "yes I will ship it"),
      timed(10, 13, "can you ship the deck"),
    ),
    false,
  );
  assert.equal(
    isEcho(
      timed(60, 63, "can you ship it by friday"),
      timed(10, 13, "can you ship it by friday"),
    ),
    false,
  );
});

test("mergeChannels suppresses echoed me lines and keeps the real me reply", () => {
  const merge = fn(channels, "mergeChannels");
  const out = merge({
    me: input("can you ship it by friday Yes, Friday works.", [
      timed(0.3, 3, "can you ship it by friday"),
      timed(4, 6, "Yes, Friday works."),
    ]),
    them: input("Can you ship it by Friday?", [
      timed(0, 3, "Can you ship it by Friday?"),
    ]),
    offsetSeconds: 0,
  });
  assert.deepEqual(
    out.map((s) => [s.speaker, s.text]),
    [
      ["them", "Can you ship it by Friday?"],
      ["me", "Yes, Friday works."],
    ],
  );
});

test("echo suppression never runs on untimed blocks (it would delete all of me)", () => {
  const merge = fn(channels, "mergeChannels");
  const out = merge({
    me: input("can you ship it by friday", undefined),
    them: input("Can you ship it by Friday?", undefined),
    offsetSeconds: 0,
  });
  assert.deepEqual(
    out.map((s) => s.speaker),
    ["me", "them"],
  );
});

// ---------------------------------------------------------------------------
// Per-segment outcome (feeds meeting_audio_segments.transcription_outcome)
// ---------------------------------------------------------------------------

test("channelSegmentOutcome: speech when any merged text, no_speech only when every present channel confirmed silence", () => {
  const outcome = fn(channels, "channelSegmentOutcome");
  const speech = [
    { speaker: "me", start: 0, end: 1, text: "hi", confidence: null },
  ];
  assert.equal(
    outcome(speech, [input("hi", []), input("", [], "no_speech")]),
    "speech",
  );
  assert.equal(
    outcome([], [input("", [], "no_speech"), input("", [], "no_speech")]),
    "no_speech",
  );
  assert.equal(outcome([], [input("", [], "no_speech"), null]), "no_speech");
  assert.equal(
    outcome(
      [],
      [
        { text: "", durationSeconds: 300, timed: [] },
        input("", [], "no_speech"),
      ],
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// Identity: me = recorder's display name, them = neutral, prior corrections win
// ---------------------------------------------------------------------------

test("resolveChannelSpeakerMap maps me to the recorder and leaves them unnamed", () => {
  const resolve = fn(channels, "resolveChannelSpeakerMap");
  assert.deepEqual(resolve("Pat Doe"), { me: "Pat Doe", them: null });
  assert.deepEqual(resolve("  "), { me: null, them: null });
  assert.deepEqual(resolve(null), { me: null, them: null });
});

test("resolveChannelSpeakerMap honors a prior human correction on re-transcription", () => {
  const resolve = fn(channels, "resolveChannelSpeakerMap");
  assert.deepEqual(resolve("Pat Doe", { me: "Pat D.", them: "Acme team" }), {
    me: "Pat D.",
    them: "Acme team",
  });
  assert.deepEqual(resolve("Pat Doe", { A: "Someone" }), {
    me: "Pat Doe",
    them: null,
  });
});

test("flattenSegments renders the reserved channel labels as Me / Them, never 'Speaker them'", () => {
  const flatten = fn(transcription, "flattenSegments");
  const segs = [
    {
      speaker: "them",
      start: 0,
      end: 1,
      text: "Who owns it?",
      confidence: null,
    },
    { speaker: "me", start: 1, end: 2, text: "I do.", confidence: null },
  ];
  assert.equal(
    flatten(segs, { me: null, them: null }),
    "Them: Who owns it?\nMe: I do.",
  );
  assert.equal(
    flatten(segs, { me: "Pat Doe", them: null }),
    "Them: Who owns it?\nPat Doe: I do.",
  );
});

// ---------------------------------------------------------------------------
// Final assembly + precedence + compatibility
// ---------------------------------------------------------------------------

const row = (seq, transcript_segments, extra = {}) => ({
  seq,
  status: "completed",
  transcript_text:
    (transcript_segments ?? []).map((s) => s.text).join(" ") || "legacy text",
  storage_path: `m1/seg-${seq}-me.m4a`,
  transcript_segments,
  ...extra,
});
const seg = (speaker, start, text) => ({
  speaker,
  start,
  end: start + 1,
  text,
  confidence: null,
});

test("assembleChannelTranscript orders rows by seq and produces the existing diarized shape", () => {
  const assemble = fn(channels, "assembleChannelTranscript");
  const out = assemble(
    [
      row(1, [seg("them", 300, "Second window.")]),
      row(0, [seg("me", 0, "First."), seg("them", 2, "Reply.")]),
    ],
    "Pat Doe",
  );
  assert.deepEqual(
    out.segments.map((s) => s.text),
    ["First.", "Reply.", "Second window."],
  );
  assert.deepEqual(out.speakerMap, { me: "Pat Doe", them: null });
  assert.equal(
    out.transcriptRaw,
    "Pat Doe: First.\nThem: Reply. Second window.",
  );
  assert.equal(out.transcriptDiarized, true);
});

test("assembleChannelTranscript with only silence is not diarized and has empty text", () => {
  const assemble = fn(channels, "assembleChannelTranscript");
  const out = assemble(
    [row(0, [], { transcript_text: "", transcription_outcome: "no_speech" })],
    "Pat Doe",
  );
  assert.equal(out.transcriptRaw, "");
  assert.equal(out.transcriptDiarized, false);
});

test("attributionSource: a configured diarizing provider wins over channels", () => {
  const source = fn(channels, "attributionSource");
  assert.equal(
    source({ diarizingConfigured: true, rows: [row(0, [seg("me", 0, "x")])] }),
    "diarizer",
  );
});

test("attributionSource: channels only when every selected row carries channel segments", () => {
  const source = fn(channels, "attributionSource");
  assert.equal(
    source({
      diarizingConfigured: false,
      rows: [row(0, [seg("me", 0, "x")]), row(1, [])],
    }),
    "channels",
  );
  assert.equal(
    source({
      diarizingConfigured: false,
      rows: [row(0, [seg("me", 0, "x")]), row(1, null)],
    }),
    "text",
  );
  assert.equal(
    source({ diarizingConfigured: false, rows: [row(0, undefined)] }),
    "text",
  );
  assert.equal(source({ diarizingConfigured: false, rows: [] }), "text");
});

// ---------------------------------------------------------------------------
// Provider timestamps (OpenRouter + Groq return segment timings in verbose_json)
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  return calls;
}
const ok = (body) => ({
  ok: true,
  status: 200,
  async json() {
    return body;
  },
});
const err = (status) => ({
  ok: false,
  status,
  async text() {
    return `err ${status}`;
  },
  async json() {
    return {};
  },
});
const blob = () => new Blob([new Uint8Array(16)], { type: "audio/mp4" });

test("OpenRouter with timestamps requests verbose_json segment granularity and returns timed segments", async () => {
  const transcribeWithOpenRouter = fn(
    transcription,
    "transcribeWithOpenRouter",
  );
  const calls = fakeFetch(() =>
    ok({
      text: "Hello there. General Kenobi.",
      usage: { seconds: 4 },
      segments: [
        { id: 0, start: 0, end: 1.2, text: " Hello there." },
        { id: 1, start: 2, end: 3.5, text: " General Kenobi." },
      ],
    }),
  );
  const result = await transcribeWithOpenRouter(blob(), {
    apiKey: "k",
    mimeType: "audio/mp4",
    timestamps: true,
  });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.response_format, "verbose_json");
  assert.deepEqual(body.timestamp_granularities, ["word", "segment"]);
  assert.deepEqual(result.timed, [
    timed(0, 1.2, "Hello there."),
    timed(2, 3.5, "General Kenobi."),
  ]);
  assert.equal(result.diarized, false);
});

test("OpenRouter without timestamps keeps the plain json body (legacy request unchanged)", async () => {
  const transcribeWithOpenRouter = fn(
    transcription,
    "transcribeWithOpenRouter",
  );
  const calls = fakeFetch(() => ok({ text: "plain", usage: { seconds: 1 } }));
  const result = await transcribeWithOpenRouter(blob(), {
    apiKey: "k",
    mimeType: "audio/mp4",
  });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.response_format, undefined);
  assert.equal(body.timestamp_granularities, undefined);
  assert.equal(result.timed, undefined);
});

test("OpenRouter model that rejects verbose_json (400) retries once as plain json, untimed", async () => {
  const transcribeWithOpenRouter = fn(
    transcription,
    "transcribeWithOpenRouter",
  );
  const calls = fakeFetch((_url, _options, n) =>
    n === 1 ? err(400) : ok({ text: "fallback", usage: { seconds: 2 } }),
  );
  const result = await transcribeWithOpenRouter(blob(), {
    apiKey: "k",
    mimeType: "audio/mp4",
    timestamps: true,
  });
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].options.body).response_format, undefined);
  assert.equal(result.text, "fallback");
  assert.equal(result.timed, undefined);
});

test("Groq verbose_json segments surface as timed segments", async () => {
  const transcribeWithGroq = fn(transcription, "transcribeWithGroq");
  fakeFetch(() =>
    ok({
      text: "a b",
      duration: 3,
      segments: [
        { id: 0, start: 0.5, end: 1, text: " a" },
        { id: 1, start: 2, end: 3, text: "b " },
      ],
    }),
  );
  const result = await transcribeWithGroq(blob(), { apiKey: "k" });
  assert.deepEqual(result.timed, [timed(0.5, 1, "a"), timed(2, 3, "b")]);
});

test("malformed provider segments are ignored rather than trusted", async () => {
  const transcribeWithGroq = fn(transcription, "transcribeWithGroq");
  fakeFetch(() =>
    ok({
      text: "a",
      duration: 1,
      segments: [
        { start: "0", end: 1, text: "a" },
        { start: 0, text: "b" },
      ],
    }),
  );
  const result = await transcribeWithGroq(blob(), { apiKey: "k" });
  assert.equal(result.timed, undefined);
});

test("transcribeAudio forwards timestamps to the OpenRouter provider", async () => {
  const transcribeAudio = fn(transcription, "transcribeAudio");
  const calls = fakeFetch(() =>
    ok({
      text: "x",
      usage: { seconds: 1 },
      segments: [{ start: 0, end: 1, text: "x" }],
    }),
  );
  const result = await transcribeAudio(blob(), {
    mimeType: "audio/mp4",
    timestamps: true,
    env: { TRANSCRIPTION_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" },
  });
  assert.equal(
    JSON.parse(calls[0].options.body).response_format,
    "verbose_json",
  );
  assert.deepEqual(result.timed, [timed(0, 1, "x")]);
});

test("ownsSegmentPaths accepts only paths inside the meeting folder", () => {
  const ownsSegmentPaths = fn(segments, "ownsSegmentPaths");
  assert.equal(ownsSegmentPaths("m1", ["m1/seg-0-me.m4a", "m1/seg-0-them.m4a"]), true);
  assert.equal(ownsSegmentPaths("m1", ["m1/seg-0.webm", null]), true);
  assert.equal(ownsSegmentPaths("m1", ["m1/seg-0-me.m4a", "m2/seg-0-them.m4a"]), false);
  assert.equal(ownsSegmentPaths("m1", ["m10/seg-0.webm"]), false);
  assert.equal(ownsSegmentPaths("m1", ["../m1/seg-0.webm"]), false);
  assert.equal(ownsSegmentPaths("m1", ["m1/../m2/seg-0.webm"]), false);
});

test("the final pass refuses a stored segment path outside its meeting", () => {
  const route = fs.readFileSync("src/app/api/meetings/[meetingId]/transcribe/route.ts", "utf8");
  assert.ok(route.includes("ownsSegmentPaths(meetingId, [row.storage_path, row.them_storage_path])"));
});
