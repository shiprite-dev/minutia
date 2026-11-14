import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Meeting-level transcription outcome contracts: the final route must persist a
// meeting outcome only with explicit terminal-silence evidence, never from empty
// text alone, and must return it on success and completed replay. The actual
// route handler is bundled and invoked with the same test-only doubles as
// scripts/verify-transcription-routes.test.mjs (doubles live only in this
// harness, never in production code).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-transcription-outcome-"));
const stubDir = path.join(tempDir, "stubs");
fs.mkdirSync(stubDir, { recursive: true });

const S = {
  meeting: null,
  claimResult: null,
  claimError: null,
  segmentRows: [],
  segmentSelect: null,
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

// Project a row onto the columns the route's SELECT actually requested, so a
// SELECT that omits transcription_outcome hides it from the resume planner.
function project(row, columns) {
  if (!columns) return row;
  const keys = columns.split(",").map((c) => c.trim()).filter(Boolean);
  const out = {};
  for (const key of keys) out[key] = row[key] ?? null;
  return out;
}

function buildSupabase() {
  return {
    from(table) {
      let columns = null;
      const builder = {
        select(cols) {
          columns = typeof cols === "string" ? cols : null;
          if (table === "meeting_audio_segments") S.segmentSelect = columns;
          return builder;
        },
        eq() { return builder; },
        in() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        single() {
          if (table === "meetings") {
            return Promise.resolve({
              data: S.meeting ? project(S.meeting, columns) : null,
              error: S.meeting ? null : { message: "nf" },
            });
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
          if (table === "meeting_audio_segments") {
            const rows = S.segmentRows.map((row) => project(row, columns));
            return resolve({ data: rows, error: null });
          }
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

const routeBundle = path.join(tempDir, "transcription-outcome-route.mjs");
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
      transcription_outcome: null,
      attendees: [],
      speaker_map: null,
      transcript_raw: "",
      transcription_model: "",
      transcription_provider: "",
    },
    claimResult: MEETING_ID,
    claimError: null,
    segmentRows: [],
    segmentSelect: null,
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

function request(body = {}) {
  return { json: async () => body, url: "https://x/api" };
}

async function callMeetingRoute(body = {}) {
  return meetingRoute.POST(request(body), { params: Promise.resolve({ meetingId: MEETING_ID }) });
}

function committedMeetingUpdate() {
  return S.meetingUpdates.find(
    (u) => u.table === "meetings" && u.row && Object.prototype.hasOwnProperty.call(u.row, "transcription_outcome")
  );
}

const terminalSilenceRow = (seq) => ({
  seq,
  status: "completed",
  transcript_text: "",
  storage_path: `${MEETING_ID}/seg-${seq}.webm`,
  model: "m",
  provider: "groq",
  transcription_outcome: "no_speech",
});

// ---------------------------------------------------------------------------
// Outcome derivation
// ---------------------------------------------------------------------------

test("a non-empty transcript persists and returns speech", async () => {
  reset();
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.outcome, "speech");
  assert.ok(body.transcript_length > 0);
  assert.equal(committedMeetingUpdate()?.row.transcription_outcome, "speech");
});

test("no_speech is persisted when every selected segment is terminal silence", async () => {
  reset({ segmentRows: [terminalSilenceRow(0), terminalSilenceRow(1)] });
  const res = await callMeetingRoute({ expected_segments: 2 });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.outcome, "no_speech");
  assert.equal(body.transcript_length, 0);
  assert.equal(S.providerCalls, 0, "terminal silence must not re-run a provider");
  assert.equal(committedMeetingUpdate()?.row.transcription_outcome, "no_speech");
});

test("provider-reported terminal silence persists no_speech without segment rows", async () => {
  reset({
    providerResult: { text: "", model: "m", provider: "groq", durationSeconds: 1, diarized: false, outcome: "no_speech" },
  });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.outcome, "no_speech");
  assert.equal(body.transcript_length, 0);
  assert.equal(committedMeetingUpdate()?.row.transcription_outcome, "no_speech");
});

test("segmented resume sees persisted outcomes in the segment SELECT", async () => {
  reset({ segmentRows: [terminalSilenceRow(0), terminalSilenceRow(1)] });
  await callMeetingRoute({ expected_segments: 2 });
  assert.ok(
    S.segmentSelect && S.segmentSelect.includes("transcription_outcome"),
    "the resume planner must be able to see terminal silence"
  );
});

test("empty text with no silence evidence persists null and writes no outcome", async () => {
  reset({
    providerResult: { text: "", model: "m", provider: "groq", durationSeconds: 1, diarized: false },
  });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.outcome, null);
  assert.equal(body.transcript_length, 0);
  assert.equal(committedMeetingUpdate(), undefined, "unknown emptiness must not be written as an outcome");
});

test("a completed empty segment without a persisted outcome is not terminal silence", async () => {
  reset({
    claimResult: true,
    segmentRows: [
      { seq: 0, status: "completed", transcript_text: "", storage_path: `${MEETING_ID}/seg-0.webm`, model: "m", provider: "groq", transcription_outcome: null },
    ],
    providerResult: { text: "", model: "m", provider: "groq", durationSeconds: 1, diarized: false },
  });
  const res = await callMeetingRoute({ expected_segments: 1 });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.outcome, null);
  assert.equal(committedMeetingUpdate(), undefined);
});

test("a retried segment's own terminal-silence evidence completes the meeting as no_speech", async () => {
  reset({
    claimResult: true,
    segmentRows: [
      terminalSilenceRow(0),
      { seq: 1, status: "completed", transcript_text: "", storage_path: `${MEETING_ID}/seg-1.webm`, model: "m", provider: "groq", transcription_outcome: null },
    ],
    providerResult: { text: "", model: "m", provider: "groq", durationSeconds: 1, diarized: false, outcome: "no_speech" },
  });
  const res = await callMeetingRoute({ expected_segments: 2 });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.outcome, "no_speech", "the retried segment carried its own terminal-silence evidence");
  assert.equal(S.providerCalls, 1, "only the unproven segment may be retried, never the whole recording");
});

// ---------------------------------------------------------------------------
// Failure and replay
// ---------------------------------------------------------------------------

test("a failed run never persists an outcome", async () => {
  reset({ providerError: new Error("provider exploded") });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.outcome, undefined);
  assert.equal(committedMeetingUpdate(), undefined);
  assert.ok(
    S.meetingUpdates.some((u) => u.table === "meetings" && u.row?.transcription_status === "failed"),
    "the run must be marked failed"
  );
});

test("completed replay returns the persisted outcome with zero provider calls and no rewrite", async () => {
  reset({
    meeting: {
      id: MEETING_ID,
      audio_file_path: null,
      audio_duration_seconds: null,
      transcription_status: "completed",
      transcription_started_at: null,
      transcription_outcome: "no_speech",
      attendees: [],
      speaker_map: null,
      transcript_raw: "",
      transcription_model: "whisper-large-v3",
      transcription_provider: "groq",
    },
  });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.replay, true);
  assert.equal(body.outcome, "no_speech");
  assert.equal(S.providerCalls, 0);
  assert.equal(S.meetingUpdates.length, 0, "replay must not rewrite the persisted outcome");
});

test("a run never overwrites an already-persisted outcome", async () => {
  reset({
    meeting: {
      id: MEETING_ID,
      audio_file_path: `${MEETING_ID}/rec.webm`,
      audio_duration_seconds: null,
      transcription_status: "pending",
      transcription_started_at: null,
      transcription_outcome: "speech",
      attendees: [],
      speaker_map: null,
      transcript_raw: "retained transcript",
      transcription_model: "m",
      transcription_provider: "groq",
    },
    providerResult: { text: "", model: "m", provider: "groq", durationSeconds: 1, diarized: false, outcome: "no_speech" },
  });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.outcome, "speech");
  assert.equal(committedMeetingUpdate(), undefined, "a persisted outcome must never be rewritten");
});

test("completed replay of a legacy unknown outcome returns null", async () => {
  reset({
    meeting: {
      id: MEETING_ID,
      audio_file_path: null,
      audio_duration_seconds: null,
      transcription_status: "completed",
      transcription_started_at: null,
      transcription_outcome: null,
      attendees: [],
      speaker_map: null,
      transcript_raw: "",
      transcription_model: "",
      transcription_provider: "",
    },
  });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.outcome, null);
});

// ---------------------------------------------------------------------------
// Distinct conflict codes
// ---------------------------------------------------------------------------

test("a fresh in-progress run returns the processing_conflict code", async () => {
  reset({
    meeting: {
      id: MEETING_ID,
      audio_file_path: "p",
      transcription_status: "processing",
      transcription_started_at: new Date().toISOString(),
      transcription_outcome: null,
      attendees: [],
      speaker_map: null,
      transcript_raw: "",
      transcription_model: "",
      transcription_provider: "",
    },
    claimResult: null,
  });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.code, "processing_conflict");
  assert.equal(typeof body.request_id, "string");
});

test("a failed claim returns the processing_conflict code", async () => {
  reset({ claimResult: null });
  const res = await callMeetingRoute();
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.code, "processing_conflict");
  assert.equal(typeof body.request_id, "string");
});
