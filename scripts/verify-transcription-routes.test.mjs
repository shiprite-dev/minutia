import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Transcription route reliability contracts (Granola-port tranche 1): the
// actual route handlers are bundled and invoked with test-only Supabase,
// storage, config, and provider doubles (repo pattern; doubles live only in
// this harness, never in production code).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-transcription-routes-"));
const stubDir = path.join(tempDir, "stubs");
fs.mkdirSync(stubDir, { recursive: true });

// Shared, mutable doubles the route's dependencies resolve to.
const S = {
  meeting: null,
  claimResult: null,
  claimError: null,
  segmentRows: [],
  segmentUpdates: [],
  meetingUpdates: [],
  configMap: {},
  configError: null,
  storageListPages: [],
  listError: null,
  removed: [],
  removeError: null,
  providerResult: null,
  providerCalls: 0,
  providerError: null,
  diarizing: false,
  extraction: { ok: true, suggestions: [], model: "m" },
  extractionThrow: null,
};

fs.writeFileSync(path.join(stubDir, "next-server.mjs"), `
export const NextResponse = {
  json(body, init = {}) {
    return { status: init.status ?? 200, async json() { return body; } };
  },
};
export class NextRequest {}
`);
fs.writeFileSync(path.join(stubDir, "supabase-server.mjs"), `
export async function createClient() { return globalThis.__S.supabase; }
`);
fs.writeFileSync(path.join(stubDir, "access.mjs"), `
export async function requireAiAccess() { return null; }
`);
fs.writeFileSync(path.join(stubDir, "suggestions.mjs"), `
export async function generateMeetingSuggestions() {
  const S = globalThis.__S;
  if (S.extractionThrow) throw S.extractionThrow;
  return S.extraction;
}
export function isExplicitSkip(outcome) {
  return !outcome.ok && (outcome.code === "skipped_no_content" || outcome.code === "skipped_unconfigured");
}
`);
fs.writeFileSync(path.join(stubDir, "audio.mjs"), `
export const MEETING_AUDIO_BUCKET = "meeting-audio";
`);
fs.writeFileSync(path.join(stubDir, "transcription.mjs"), `
import { TranscriptionError } from "./transcription-shared.mjs";
export class TError extends TranscriptionError {}
export { TranscriptionError };
export function isDiarizingProviderConfigured() { return globalThis.__S.diarizing; }
export function isTranscriptionConfigured() { return true; }
export async function transcribeAudio(audio, options = {}) {
  const S = globalThis.__S;
  S.providerCalls += 1;
  if (S.providerError) throw S.providerError;
  return S.providerResult;
}
export async function assembleDiarizedTranscript() { return { transcriptRaw: "", segments: null, speakerMap: null }; }
export async function chunkAudioBlob(audio) { return [audio]; }
`);
fs.writeFileSync(path.join(stubDir, "transcription-shared.mjs"), `
export class TranscriptionError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "TranscriptionError";
    this.code = code;
    this.status = options.status;
    this.provider = options.provider;
  }
}
`);
fs.writeFileSync(path.join(stubDir, "instance-config.mjs"), `
export class InstanceConfigReadError extends Error {
  constructor(cause) { super("Instance configuration is unavailable", { cause }); this.name = "InstanceConfigReadError"; }
}
export async function getInstanceConfigMap(keys) {
  const S = globalThis.__S;
  if (S.configError) throw new InstanceConfigReadError(S.configError);
  const map = {};
  for (const k of keys) if (k in S.configMap) map[k] = S.configMap[k];
  return map;
}
`);
fs.writeFileSync(path.join(stubDir, "segments.mjs"), `
export function parseSegmentPath() { return { ext: "webm" }; }
export function segmentMimeForExt() { return "audio/webm"; }
`);

// Test-side Supabase double. Chainable; every table write is recorded.
function buildSupabase() {
  return {
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        single() {
          if (table === "meetings") {
            return Promise.resolve({ data: S.meeting, error: S.meeting ? null : { message: "nf" } });
          }
          if (table === "meeting_audio_segments") {
            const row = S.segmentRows.find((r) => r.seq === S.__seq) ?? null;
            return Promise.resolve({ data: row, error: null });
          }
          return Promise.resolve({ data: null, error: { message: "unexpected table" } });
        },
        update(row) {
          S.meetingUpdates.push({ table, row });
          return builder;
        },
        delete() {
          S.meetingUpdates.push({ table, op: "delete" });
          return builder;
        },
        upsert() { return builder; },
        async then(resolve) {
          if (table === "meetings") return resolve({ data: S.meeting, error: S.meeting ? null : { message: "nf" } });
          if (table === "meeting_audio_segments") return resolve({ data: S.segmentRows, error: null });
          return resolve({ data: null, error: null });
        },
      };
      return builder;
    },
    rpc(name) {
      if (name === "claim_meeting_transcription") {
        return Promise.resolve({ data: S.claimResult, error: S.claimError });
      }
      if (name === "claim_segment_transcription") {
        S.__seq = S.__pendingSeq;
        return Promise.resolve({ data: S.claimResult, error: S.claimError });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
    },
    storage: {
      from() {
        return {
          async download() { return { data: new Blob(["x"]), error: null }; },
          list(folder, { limit, offset } = {}) {
            if (S.listError) return { data: null, error: S.listError };
            const start = offset ?? 0;
            const page = S.storageListPages.slice(start, start + (limit ?? 100)).map((n) => ({ name: `${n}` }));
            return { data: page, error: null };
          },
          async remove(paths) {
            if (S.removeError) return { data: null, error: S.removeError };
            S.removed.push(...paths);
            return { data: null, error: null };
          },
        };
      },
    },
  };
}

function stubPlugin() {
  return {
    name: "route-stubs",
    setup(instance) {
      const map = {
        "@/lib/supabase/server": "supabase-server.mjs",
        "@/lib/ai/access": "access.mjs",
        "@/lib/ai/suggestions": "suggestions.mjs",
        "@/lib/audio": "audio.mjs",
        "@/lib/transcription": "transcription.mjs",
        "@/lib/instance-config": "instance-config.mjs",
        "@/lib/audio/segments": "segments.mjs",
      };
      for (const [specifier, file] of Object.entries(map)) {
        instance.onResolve({ filter: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}$`) }, () => ({
          path: path.join(stubDir, file),
        }));
      }
      instance.onResolve({ filter: /^next\/server$/ }, () => ({
        path: path.join(stubDir, "next-server.mjs"),
      }));
    },
  };
}

const routeBundle = path.join(tempDir, "transcribe-route.mjs");
await esbuild.build({
  entryPoints: ["src/app/api/meetings/[meetingId]/transcribe/route.ts"],
  outfile: routeBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  plugins: [stubPlugin()],
});
const meetingRoute = await import(pathToFileURL(routeBundle).href);

const segmentBundle = path.join(tempDir, "segment-route.mjs");
await esbuild.build({
  entryPoints: ["src/app/api/meetings/[meetingId]/segments/[seq]/transcribe/route.ts"],
  outfile: segmentBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  plugins: [stubPlugin()],
});
const segmentRoute = await import(pathToFileURL(segmentBundle).href);

globalThis.__S = S;

const MEETING_ID = "30000000-0000-0000-0000-000000000003";

function reset(overrides = {}) {
  Object.assign(S, {
    meeting: {
      id: MEETING_ID,
      audio_file_path: `${MEETING_ID}/rec.webm`,
      audio_duration_seconds: null,
      transcription_status: "uploaded",
      transcription_started_at: null,
      attendees: [],
      speaker_map: null,
      transcript_raw: "",
      transcription_model: "",
      transcription_provider: "",
    },
    claimResult: MEETING_ID,
    claimError: null,
    segmentRows: [],
    meetingUpdates: [],
    configMap: {},
    configError: null,
    storageListPages: ["rec.webm"],
    listError: null,
    removed: [],
    removeError: null,
    providerResult: { text: "hello world", model: "m", provider: "groq", durationSeconds: 1, diarized: false, outcome: "speech" },
    providerCalls: 0,
    providerError: null,
    diarizing: false,
    extraction: { ok: true, suggestions: [], model: "m" },
    extractionThrow: null,
    __seq: null,
    __pendingSeq: null,
  }, overrides);
  globalThis.__S.supabase = buildSupabase();
}

function request() {
  return { json: async () => ({}), url: "https://x/api" };
}

async function callMeetingRoute() {
  return meetingRoute.POST(request(), { params: Promise.resolve({ meetingId: MEETING_ID }) });
}

// ---------------------------------------------------------------------------
// Idempotent replay
// ---------------------------------------------------------------------------

test("a completed meeting replays its persisted result with zero provider calls", async () => {
  reset({
    meeting: {
      id: MEETING_ID,
      audio_file_path: null,
      transcription_status: "completed",
      transcription_started_at: null,
      attendees: [],
      speaker_map: null,
      transcript_raw: "persisted transcript",
      transcription_model: "whisper-large-v3",
      transcription_provider: "groq",
    },
  });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.replay, true);
  assert.equal(body.transcript_length, "persisted transcript".length);
  assert.equal(body.audio_discarded, false);
  assert.equal(S.providerCalls, 0, "replay must not re-run the provider");
  assert.equal(S.removed.length, 0, "replay must not touch storage");
});

test("a fresh in-progress run blocks with 409 before any provider call", async () => {
  reset({
    meeting: {
      id: MEETING_ID,
      audio_file_path: "p",
      transcription_status: "processing",
      transcription_started_at: new Date().toISOString(),
      attendees: [],
      speaker_map: null,
      transcript_raw: "",
      transcription_model: "",
      transcription_provider: "",
    },
    claimResult: null,
  });
  const res = await callMeetingRoute();
  assert.equal(res.status, 409);
  assert.equal(S.providerCalls, 0);
});

// ---------------------------------------------------------------------------
// Extraction gate + truthful cleanup
// ---------------------------------------------------------------------------

test("a failed extraction blocks every storage deletion and reports honestly", async () => {
  reset({ extraction: { ok: false, status: 502, error: "AI provider request failed.", code: "provider_error" } });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.code, "extraction_failed");
  assert.equal(body.transcription_status, "completed");
  assert.equal(body.audio_discarded, false);
  assert.equal(S.removed.length, 0, "no audio deletion after failed extraction");
  assert.ok(
    !S.meetingUpdates.some((u) => u.table === "meetings" && u.row?.audio_file_path === null),
    "pointers must not be cleared after failed extraction"
  );
});

test("an explicit unconfigured skip proceeds to verified cleanup", async () => {
  reset({
    extraction: { ok: false, status: 503, error: "AI is not configured.", code: "skipped_unconfigured" },
  });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.audio_discarded, true);
  assert.equal(S.removed.length, 1);
  assert.ok(S.removed[0].endsWith("rec.webm"));
});

test("a config read failure postpones cleanup without deleting anything", async () => {
  reset({ configError: { message: "db outage" } });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.audio_discarded, false);
  assert.equal(S.removed.length, 0, "a failed config read must not be read as 'discard by default'");
});

test("a remove failure prevents pointer clearing and segment-row deletion", async () => {
  reset({ removeError: { message: "storage down" } });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(body.audio_discarded, false);
  assert.ok(
    !S.meetingUpdates.some((u) => u.table === "meetings" && u.row?.audio_file_path === null),
    "pointers must not clear on a failed removal"
  );
  assert.ok(!S.meetingUpdates.some((u) => u.table === "meeting_audio_segments" && u.op === "delete"));
});

test("a listing failure preserves pointers and reports audio retained", async () => {
  reset({ listError: { message: "list failed" } });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(body.audio_discarded, false);
  assert.equal(S.removed.length, 0);
});

test("cleanup enumerates every storage page before deleting", async () => {
  reset({ storageListPages: Array.from({ length: 150 }, (_, i) => `seg-${i}.webm`) });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(body.audio_discarded, true);
  assert.equal(S.removed.length, 150, "both pages must be enumerated and deleted");
});

test("a transcript-save failure prevents extraction and cleanup", async () => {
  // The main transcript update fails: simulate via meetingUpdates recording +
  // a claim that succeeds but a meetings update that returns an error.
  reset();
  const supabase = globalThis.__S.supabase;
  // Make the committed update fail by hijacking the table write.
  const origFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    const builder = origFrom(table);
    if (table === "meetings") {
      return new Proxy(builder, {
        get(target, prop) {
          if (prop === "then") {
            return (resolve) => resolve({ data: null, error: null });
          }
          if (prop === "update") {
            return (row) => {
              S.meetingUpdates.push({ table, row });
              return { eq: () => Promise.resolve({ data: null, error: { message: "write failed" } }) };
            };
          }
          return target[prop];
        },
      });
    }
    return builder;
  };
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.error, "Transcription completed but could not be saved.");
  assert.equal(S.removed.length, 0);
});

// ---------------------------------------------------------------------------
// Segment route replay
// ---------------------------------------------------------------------------

async function callSegmentRoute(seq = 0) {
  S.__pendingSeq = seq;
  return segmentRoute.POST(request(), {
    params: Promise.resolve({ meetingId: MEETING_ID, seq: String(seq) }),
  });
}

test("a completed segment replays its persisted result on claim loss", async () => {
  reset({
    claimResult: false,
    segmentRows: [
      { seq: 0, status: "completed", transcript_text: "hello", model: "m", provider: "groq", transcription_outcome: "speech" },
    ],
  });
  const res = await callSegmentRoute(0);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.replay, true);
  assert.equal(body.transcript_length, 5);
  assert.equal(S.providerCalls, 0);
});

test("a claim loss on a processing segment still 409s", async () => {
  reset({
    claimResult: false,
    segmentRows: [{ seq: 0, status: "processing", transcript_text: null }],
  });
  const res = await callSegmentRoute(0);
  assert.equal(res.status, 409);
});

test("a claim loss with an unreadable row surfaces an error", async () => {
  reset({ claimResult: false, segmentRows: [] });
  const res = await callSegmentRoute(0);
  assert.equal(res.status, 500);
});

test("a successful segment transcription persists the outcome", async () => {
  reset({
    claimResult: true,
    providerResult: { text: "", model: "m", provider: "groq", durationSeconds: 0, diarized: false, outcome: "no_speech" },
  });
  const res = await callSegmentRoute(0);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.transcript_length, 0);
});