// Contract: POST in src/app/api/meetings/[meetingId]/transcript/route.ts; extract and retain shared from src/lib/transcription/after-transcript.ts by this route and the transcribe route.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "minutia-device-transcript-route-"),
);
const stubDir = path.join(tempDir, "stubs");
fs.mkdirSync(stubDir, { recursive: true });

const S = {};
globalThis.__S = S;

fs.writeFileSync(
  path.join(stubDir, "next-server.mjs"),
  `
export const NextResponse = {
  json(body, init = {}) {
    return { status: init.status ?? 200, async json() { return body; } };
  },
};
export class NextRequest {}
export function after(task) { globalThis.__S.afterTasks.push(task); }
`,
);
fs.writeFileSync(
  path.join(stubDir, "supabase-server.mjs"),
  `export async function createClient() { return globalThis.__S.supabase; }`,
);
fs.writeFileSync(
  path.join(stubDir, "access.mjs"),
  `
import { NextResponse } from "next/server";
export async function requireAiAccess() {
  const S = globalThis.__S;
  if (!S.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!S.aiAccess) return NextResponse.json({ error: "AI features are not enabled for this account.", code: "FEATURE_UNAVAILABLE" }, { status: 403 });
  return null;
}
export async function hasAiAccess() {
  const S = globalThis.__S;
  return !!S.user && S.aiAccess;
}
`,
);
fs.writeFileSync(
  path.join(stubDir, "suggestions.mjs"),
  `
export async function generateMeetingSuggestions(supabase, meetingId) {
  const S = globalThis.__S;
  S.calls.push("suggestions");
  S.suggestionCalls.push(meetingId);
  if (S.extractionThrow) throw S.extractionThrow;
  return S.extraction;
}
export function isExplicitSkip(outcome) {
  return !outcome.ok && (outcome.code === "skipped_no_content" || outcome.code === "skipped_unconfigured");
}
`,
);
fs.writeFileSync(
  path.join(stubDir, "audio.mjs"),
  `export const MEETING_AUDIO_BUCKET = "meeting-audio";`,
);
fs.writeFileSync(
  path.join(stubDir, "instance-config.mjs"),
  `
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
`,
);

function stubPlugin() {
  return {
    name: "device-route-stubs",
    setup(build) {
      const map = {
        "@/lib/supabase/server": "supabase-server.mjs",
        "@/lib/ai/access": "access.mjs",
        "@/lib/ai/suggestions": "suggestions.mjs",
        "@/lib/audio": "audio.mjs",
        "@/lib/instance-config": "instance-config.mjs",
        "next/server": "next-server.mjs",
      };
      for (const [specifier, file] of Object.entries(map)) {
        const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
        build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
          path: path.join(stubDir, file),
        }));
      }
    },
  };
}

const ROUTE = "src/app/api/meetings/[meetingId]/transcript/route.ts";
let route;
try {
  const outfile = path.join(tempDir, "device-transcript-route.mjs");
  await esbuild.build({
    entryPoints: [ROUTE],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    absWorkingDir: root,
    plugins: [stubPlugin()],
  });
  route = await import(pathToFileURL(outfile).href);
} catch (error) {
  route = { __buildError: error.errors?.[0]?.text ?? String(error) };
}

const MEETING_ID = "30000000-0000-0000-0000-000000000212";
const USER_ID = "10000000-0000-0000-0000-000000000001";

function buildSupabase() {
  return {
    auth: {
      async getUser() {
        S.calls.push("auth.getUser");
        return {
          data: { user: S.user },
          error: S.user ? null : { message: "no session" },
        };
      },
    },
    from(table) {
      let pending = null;
      const builder = {
        select() {
          if (!pending) S.calls.push(`select:${table}`);
          return builder;
        },
        eq() {
          return builder;
        },
        in() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        single() {
          if (table === "meetings") {
            return Promise.resolve({
              data: S.meeting,
              error: S.meeting ? null : { message: "nf", code: "PGRST116" },
            });
          }
          if (table === "profiles") {
            return Promise.resolve({
              data: { id: USER_ID, name: S.recorderName },
              error: null,
            });
          }
          return Promise.resolve({
            data: null,
            error: { message: "unexpected table" },
          });
        },
        maybeSingle() {
          return builder.single();
        },
        update(row) {
          pending = { table, op: "update", row };
          S.writes.push(pending);
          S.calls.push(`update:${table}`);
          return builder;
        },
        delete() {
          pending = { table, op: "delete" };
          S.writes.push(pending);
          S.calls.push(`delete:${table}`);
          return builder;
        },
        insert(row) {
          pending = { table, op: "insert", row };
          S.writes.push(pending);
          return builder;
        },
        then(resolve, reject) {
          let result;
          if (pending) {
            const error = S.writeError?.(pending) ?? null;
            result = { data: null, error };
          } else if (table === "meetings") {
            result = { data: S.meeting ? [S.meeting] : [], error: null };
          } else {
            result = { data: [], error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(name, args) {
      S.calls.push(`rpc:${name}`);
      S.rpcCalls.push({ name, args });
      if (name === "claim_meeting_transcription") {
        S.onClaim?.();
        return Promise.resolve({ data: S.claimResult, error: S.claimError });
      }
      return Promise.resolve({
        data: null,
        error: { message: "unexpected rpc" },
      });
    },
    storage: {
      from(bucket) {
        return {
          async list(folder, { limit = 100, offset = 0 } = {}) {
            S.calls.push("storage.list");
            if (S.listError) return { data: null, error: S.listError };
            const page = S.storageObjects
              .slice(offset, offset + limit)
              .map((name) => ({ name }));
            return { data: page, error: null };
          },
          async remove(paths) {
            S.calls.push("storage.remove");
            S.removed.push(...paths.map((p) => `${bucket}:${p}`));
            return { data: null, error: null };
          },
          async download() {
            S.calls.push("storage.download");
            return {
              data: null,
              error: { message: "device route must not download" },
            };
          },
        };
      },
    },
  };
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

function validBody(overrides = {}) {
  return {
    schema_version: 1,
    source: source(),
    language: "en",
    duration_seconds: 1834.2,
    outcome: "speech",
    segments: [
      {
        speaker: "them",
        start: 3.4,
        end: 7.9,
        text: "The vendor contract is still blocked.",
        confidence: 0.9,
      },
      {
        speaker: "me",
        start: 0.42,
        end: 3.1,
        text: "Let us start with the open items.",
        confidence: 0.93,
      },
      {
        speaker: "me",
        start: 3.48,
        end: 7.98,
        text: "The vendor contract is still blocked.",
        confidence: 0.4,
      },
    ],
    ...overrides,
  };
}

const EXPECTED_RAW =
  "Ada Lovelace: Let us start with the open items.\nThem: The vendor contract is still blocked.";

function reset(overrides = {}) {
  for (const key of Object.keys(S)) delete S[key];
  Object.assign(
    S,
    {
      user: { id: USER_ID, email: "test@example.com" },
      aiAccess: true,
      recorderName: "Ada Lovelace",
      meeting: {
        id: MEETING_ID,
        series_id: "20000000-0000-0000-0000-000000000001",
        audio_file_path: null,
        audio_duration_seconds: null,
        transcription_status: "pending",
        transcription_started_at: null,
        transcription_outcome: null,
        transcription_provider: null,
        transcription_model: null,
        transcript_raw: null,
        transcript_segments: null,
        speaker_map: null,
        attendees: ["Ada Lovelace", "Grace Hopper"],
      },
      claimResult: MEETING_ID,
      claimError: null,
      writeError: null,
      configMap: {},
      configError: null,
      storageObjects: [],
      listError: null,
      removed: [],
      extraction: { ok: true, suggestions: [], model: "m" },
      extractionThrow: null,
      suggestionCalls: [],
      rpcCalls: [],
      writes: [],
      calls: [],
      afterTasks: [],
      bodyReads: 0,
    },
    overrides,
  );
  S.supabase = buildSupabase();
}

function textStream(text) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream(
    {
      pull(controller) {
        if (offset === 0) S.bodyReads += 1;
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, offset + 65536));
        offset += 65536;
      },
    },
    { highWaterMark: 0 },
  );
}

function makeRequest(raw, headers = {}, body) {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  return {
    body: body ?? textStream(text),
    url: `https://example.com/api/meetings/${MEETING_ID}/transcript`,
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(text)),
      authorization: "Bearer test-token",
      ...headers,
    }),
    async text() {
      S.bodyReads += 1;
      return text;
    },
    async json() {
      S.bodyReads += 1;
      return JSON.parse(text);
    },
    async arrayBuffer() {
      S.bodyReads += 1;
      return new TextEncoder().encode(text).buffer;
    },
  };
}

async function post(raw = validBody(), headers, body) {
  assert.equal(
    route.__buildError,
    undefined,
    `${ROUTE} failed to build: ${route.__buildError}`,
  );
  assert.equal(typeof route.POST, "function", "route must export POST");
  const res = await route.POST(makeRequest(raw, headers, body), {
    params: Promise.resolve({ meetingId: MEETING_ID }),
  });
  return { status: res.status, body: await res.json() };
}

async function runAfter() {
  for (const task of S.afterTasks.splice(0)) await task();
}

const completedWrite = () =>
  S.writes.find(
    (w) =>
      w.table === "meetings" &&
      w.op === "update" &&
      w.row?.transcription_status === "completed",
  );
const meetingWrites = () => S.writes.filter((w) => w.table === "meetings");
const claimed = () =>
  S.rpcCalls.some((c) => c.name === "claim_meeting_transcription");

function captureLogs() {
  const lines = [];
  const original = {
    error: console.error,
    warn: console.warn,
    log: console.log,
    info: console.info,
  };
  for (const level of Object.keys(original)) {
    console[level] = (...args) =>
      lines.push(
        args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" "),
      );
  }
  return {
    lines,
    restore() {
      Object.assign(console, original);
    },
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("a valid transcript from a signed-in member is saved as a completed device transcript", async () => {
  reset();
  const { status, body } = await post();
  assert.equal(status, 200, JSON.stringify(body));

  assert.deepEqual(
    S.rpcCalls.find((c) => c.name === "claim_meeting_transcription")?.args
      ?.p_meeting_id,
    MEETING_ID,
  );
  const write = completedWrite();
  assert.ok(write, "the meeting row is updated to completed");
  const row = write.row;
  assert.equal(row.transcription_provider, "device");
  assert.equal(row.transcription_model, "parakeet-tdt-0.6b-v3-coreml");
  assert.equal(row.transcript_diarized, true);
  assert.deepEqual(row.speaker_map, { me: "Ada Lovelace", them: null });
  assert.deepEqual(row.transcript_segments, [
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
  ]);
  assert.equal(row.transcript_raw, EXPECTED_RAW);
  assert.equal(row.transcription_outcome, "speech");
  assert.equal(row.transcript_language, "en");
  assert.deepEqual(row.transcription_source, source());
  assert.ok(
    !Number.isNaN(Date.parse(row.transcription_completed_at)),
    "transcription_completed_at is a timestamp",
  );
  assert.equal(row.audio_duration_seconds, 1834);
  assert.equal(
    S.calls.includes("storage.download"),
    false,
    "device mode never downloads audio",
  );

  assert.equal(body.status, "completed");
  assert.equal(body.outcome, "speech");
  assert.equal(body.transcript_length, EXPECTED_RAW.length);
  assert.equal(body.segments, 2);
  assert.equal(body.provider, "device");
  assert.equal(body.model, "parakeet-tdt-0.6b-v3-coreml");
  assert.equal(body.deferred, true);
  assert.equal(body.audio_discarded, false);
  assert.equal(typeof body.request_id, "string");
  assert.ok(body.request_id.length > 0);
  assert.notEqual(body.replay, true);
});

test("a recorded duration is never overwritten", async () => {
  reset();
  S.meeting.audio_duration_seconds = 1800;
  const { status } = await post();
  assert.equal(status, 200);
  assert.equal("audio_duration_seconds" in completedWrite().row, false);
});

test("a prior human speaker correction wins", async () => {
  reset();
  S.meeting.speaker_map = { me: "Grace Hopper", them: "Vendor Rep" };
  const { status } = await post();
  assert.equal(status, 200);
  const row = completedWrite().row;
  assert.deepEqual(row.speaker_map, { me: "Grace Hopper", them: "Vendor Rep" });
  assert.ok(row.transcript_raw.startsWith("Grace Hopper: "));
});

test("outcome no_speech with zero segments stores transcription_outcome no_speech", async () => {
  reset();
  const { status, body } = await post(
    validBody({ outcome: "no_speech", segments: [] }),
  );
  assert.equal(status, 200, JSON.stringify(body));
  const row = completedWrite().row;
  assert.equal(row.transcription_outcome, "no_speech");
  assert.equal(row.transcript_raw, "");
  assert.equal(row.transcription_provider, "device");
  assert.equal(body.outcome, "no_speech");
  assert.equal(body.transcript_length, 0);
  assert.equal(body.segments, 0);
});

test("a stale processing claim is reclaimed", async () => {
  reset();
  S.meeting.transcription_status = "processing";
  S.meeting.transcription_started_at = new Date(
    Date.now() - 20 * 60 * 1000,
  ).toISOString();
  const { status } = await post();
  assert.equal(status, 200);
  assert.ok(completedWrite());
});

test("a failed earlier run can be resubmitted", async () => {
  reset();
  S.meeting.transcription_status = "failed";
  const { status } = await post();
  assert.equal(status, 200);
  assert.ok(completedWrite());
});

// ---------------------------------------------------------------------------
// Idempotency and races
// ---------------------------------------------------------------------------

test("a second identical request replays with no writes", async () => {
  reset();
  const first = await post();
  assert.equal(first.status, 200);
  Object.assign(S.meeting, completedWrite().row);
  await runAfter();
  S.writes.length = 0;
  S.rpcCalls.length = 0;
  S.afterTasks.length = 0;
  S.suggestionCalls.length = 0;

  const second = await post();
  assert.equal(second.status, 200);
  assert.equal(second.body.replay, true);
  assert.equal(second.body.status, "completed");
  assert.equal(second.body.outcome, "speech");
  assert.equal(second.body.provider, "device");
  assert.equal(second.body.transcript_length, EXPECTED_RAW.length);
  assert.equal(typeof second.body.request_id, "string");
  assert.deepEqual(S.writes, [], "replay writes nothing");
  assert.equal(claimed(), false, "replay never claims");
  assert.equal(S.afterTasks.length, 0, "replay schedules no extraction");
  assert.equal(S.suggestionCalls.length, 0);
});

test("a completed meeting replays even when it was transcribed in the cloud", async () => {
  reset();
  Object.assign(S.meeting, {
    transcription_status: "completed",
    transcription_provider: "groq",
    transcription_model: "whisper-large-v3-turbo",
    transcription_outcome: "speech",
    transcript_raw: "persisted",
  });
  const { status, body } = await post();
  assert.equal(status, 200);
  assert.equal(body.replay, true);
  assert.equal(body.provider, "groq");
  assert.equal(body.transcript_length, "persisted".length);
  assert.deepEqual(S.writes, []);
});

test("a fresh processing claim returns 409 processing_conflict and writes nothing", async () => {
  reset({ claimResult: null });
  S.meeting.transcription_status = "processing";
  S.meeting.transcription_started_at = new Date().toISOString();
  const { status, body } = await post();
  assert.equal(status, 409);
  assert.equal(body.code, "processing_conflict");
  assert.equal(typeof body.request_id, "string");
  assert.deepEqual(meetingWrites(), []);
  assert.equal(S.afterTasks.length, 0);
});

test("losing the atomic claim race returns 409 processing_conflict", async () => {
  reset({ claimResult: null });
  const { status, body } = await post();
  assert.equal(status, 409);
  assert.equal(body.code, "processing_conflict");
  assert.deepEqual(meetingWrites(), []);
});

test("a duplicate that loses the claim to a submit that completed replays instead of 409", async () => {
  reset({ claimResult: null });
  S.onClaim = () => {
    S.meeting.transcription_status = "completed";
    S.meeting.transcription_provider = "device";
    S.meeting.transcription_model = "parakeet-tdt-0.6b-v3-coreml";
    S.meeting.transcript_raw = "saved by the first request";
  };
  const { status, body } = await post();
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.replay, true);
  assert.equal(body.provider, "device");
  assert.equal(body.transcript_length, "saved by the first request".length);
  assert.deepEqual(meetingWrites(), []);
  assert.equal(S.afterTasks.length, 0);
});

test("a claim error returns 500 without writing", async () => {
  reset({ claimError: { message: "rpc down" } });
  const { status, body } = await post();
  assert.equal(status, 500);
  assert.equal(typeof body.request_id, "string");
  assert.deepEqual(meetingWrites(), []);
});

// ---------------------------------------------------------------------------
// Auth and authorization
// ---------------------------------------------------------------------------

test("a request without a session returns 401 and touches nothing", async () => {
  reset({ user: null });
  const { status, body } = await post();
  assert.equal(status, 401);
  assert.equal(typeof body.request_id, "string");
  assert.equal(claimed(), false);
  assert.deepEqual(S.writes, []);
});

test("a meeting the caller cannot see returns 404", async () => {
  reset({ meeting: null });
  const { status, body } = await post();
  assert.equal(status, 404);
  assert.equal(typeof body.request_id, "string");
  assert.equal(claimed(), false);
  assert.deepEqual(S.writes, []);
});

test("an account without the AI entitlement still saves the transcript and runs no suggestions", async () => {
  reset({ aiAccess: false });
  const { status, body } = await post();
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(completedWrite(), "the transcript is saved");
  await runAfter();
  assert.equal(
    S.suggestionCalls.length,
    0,
    "suggestions never run without the entitlement",
  );
});

// ---------------------------------------------------------------------------
// Size and validation
// ---------------------------------------------------------------------------

test("a Content-Length over 2 MB returns 413 before the body is read", async () => {
  reset();
  const { status, body } = await post(validBody(), {
    "content-length": String(2 * 1024 * 1024 + 1),
  });
  assert.equal(status, 413);
  assert.equal(body.code, "payload_too_large");
  assert.equal(typeof body.request_id, "string");
  assert.equal(S.bodyReads, 0, "the body is never parsed");
  assert.equal(claimed(), false);
  assert.deepEqual(S.writes, []);
});

test("a body over 2 MB without a Content-Length still returns 413", async () => {
  reset();
  const raw = JSON.stringify({
    ...validBody(),
    padding: "p".repeat(2 * 1024 * 1024),
  });
  const { status, body } = await post(raw, { "content-length": "" });
  assert.equal(status, 413);
  assert.equal(body.code, "payload_too_large");
  assert.equal(claimed(), false);
  assert.deepEqual(S.writes, []);
});

test("malformed JSON returns 400 invalid_body and leaves state untouched", async () => {
  reset();
  const { status, body } = await post("{not json");
  assert.equal(status, 400);
  assert.equal(body.code, "invalid_body");
  assert.equal(claimed(), false);
  assert.deepEqual(S.writes, []);
});

test("an invalid body returns 400 with field paths only and leaves transcription_status unchanged", async () => {
  reset();
  const secret = "the acquisition closes on friday";
  const bad = validBody({
    segments: [
      { speaker: "boss", start: 0, end: 1, text: secret, confidence: 0.9 },
    ],
  });
  const { status, body } = await post(bad);
  assert.equal(status, 400);
  assert.equal(body.code, "invalid_body");
  assert.ok(Array.isArray(body.fields));
  assert.ok(
    body.fields.includes("segments.0.speaker"),
    JSON.stringify(body.fields),
  );
  assert.equal(typeof body.request_id, "string");
  assert.ok(
    !JSON.stringify(body).includes(secret),
    "errors never echo content",
  );
  assert.equal(claimed(), false, "validation runs before the claim");
  assert.deepEqual(S.writes, []);
  assert.equal(S.meeting.transcription_status, "pending");
});

test("speech with zero segments is rejected before the claim", async () => {
  reset();
  const { status, body } = await post(validBody({ segments: [] }));
  assert.equal(status, 400);
  assert.equal(body.code, "invalid_body");
  assert.ok(body.fields.includes("segments"));
  assert.equal(claimed(), false);
});

test("a client-supplied full transcript field is rejected", async () => {
  reset();
  const { status, body } = await post(
    validBody({ transcript_raw: "Ada: forged" }),
  );
  assert.equal(status, 400);
  assert.ok(body.fields.includes("transcript_raw"));
  assert.deepEqual(S.writes, []);
});

// ---------------------------------------------------------------------------
// Save failure
// ---------------------------------------------------------------------------

test("a failed save marks the meeting failed, returns 500 and schedules nothing", async () => {
  reset({
    writeError: (w) =>
      w.table === "meetings" &&
      w.op === "update" &&
      w.row?.transcription_status === "completed"
        ? { message: "write failed" }
        : null,
  });
  const logs = captureLogs();
  let result;
  try {
    result = await post();
  } finally {
    logs.restore();
  }
  assert.equal(result.status, 500);
  assert.equal(typeof result.body.request_id, "string");
  assert.ok(
    S.writes.some(
      (w) =>
        w.table === "meetings" &&
        w.op === "update" &&
        w.row?.transcription_status === "failed",
    ),
    "the claimed row is marked failed",
  );
  assert.equal(S.afterTasks.length, 0);
  assert.ok(
    !logs.lines.some(
      (l) => l.includes("vendor contract") || l.includes("open items"),
    ),
    "logs never contain transcript text",
  );
});

// ---------------------------------------------------------------------------
// After the response: extract then retain
// ---------------------------------------------------------------------------

test("suggestion extraction runs after the response, then retention removes leftover audio", async () => {
  reset({ storageObjects: ["seg-0-me.m4a", "recording.m4a"] });
  const { status, body } = await post();
  assert.equal(status, 200);
  assert.equal(body.audio_discarded, false);
  assert.equal(S.suggestionCalls.length, 0, "nothing runs before the response");
  assert.deepEqual(S.removed, []);
  assert.equal(S.afterTasks.length, 1);

  await runAfter();
  assert.deepEqual(S.suggestionCalls, [MEETING_ID]);
  assert.deepEqual(S.removed.sort(), [
    `meeting-audio:${MEETING_ID}/recording.m4a`,
    `meeting-audio:${MEETING_ID}/seg-0-me.m4a`,
  ]);
  assert.ok(
    S.calls.indexOf("suggestions") < S.calls.indexOf("storage.remove"),
    "extract runs before retain",
  );
  assert.ok(
    S.writes.some(
      (w) =>
        w.table === "meetings" &&
        w.op === "update" &&
        w.row?.audio_file_path === null,
    ),
  );
  assert.ok(
    S.writes.some(
      (w) => w.table === "meeting_audio_segments" && w.op === "delete",
    ),
  );
});

test("unconfigured AI is skipped without error and retention still runs", async () => {
  reset({
    storageObjects: ["recording.m4a"],
    extraction: {
      ok: false,
      status: 503,
      error: "AI is not configured on this instance.",
      code: "skipped_unconfigured",
    },
  });
  const { status } = await post();
  assert.equal(status, 200);
  await runAfter();
  assert.deepEqual(S.removed, [`meeting-audio:${MEETING_ID}/recording.m4a`]);
});

test("a failed extraction keeps leftover audio", async () => {
  reset({
    storageObjects: ["recording.m4a"],
    extraction: {
      ok: false,
      status: 502,
      error: "AI provider request failed.",
      code: "provider_error",
    },
  });
  const logs = captureLogs();
  try {
    await post();
    await runAfter();
  } finally {
    logs.restore();
  }
  assert.deepEqual(S.removed, []);
  assert.ok(
    !S.writes.some(
      (w) => w.table === "meetings" && w.row?.audio_file_path === null,
    ),
  );
});

test("keep_forever keeps leftover audio", async () => {
  reset({
    storageObjects: ["recording.m4a"],
    configMap: { audio_retention: "keep_forever" },
  });
  await post();
  await runAfter();
  assert.equal(S.suggestionCalls.length, 1);
  assert.deepEqual(S.removed, []);
});

for (const retention of ["keep_forever", "discard_after_transcript"]) {
  test(`a device meeting with no audio passes retention without error under ${retention}`, async () => {
    reset({ storageObjects: [], configMap: { audio_retention: retention } });
    const { status } = await post();
    assert.equal(status, 200);
    const logs = captureLogs();
    try {
      await runAfter();
    } finally {
      logs.restore();
    }
    assert.deepEqual(S.removed, []);
    assert.equal(S.calls.includes("storage.remove"), false);
    assert.deepEqual(
      logs.lines.filter((l) => /retention|failed|error/i.test(l)),
      [],
      "no retention error is logged",
    );
  });
}

// ---------------------------------------------------------------------------
// Shared post-transcript steps
// ---------------------------------------------------------------------------

test("both transcript routes share extract and retain from after-transcript.ts", () => {
  const shared = "src/lib/transcription/after-transcript.ts";
  assert.ok(fs.existsSync(path.join(root, shared)), `${shared} must exist`);
  const transcribe = fs.readFileSync(
    path.join(root, "src/app/api/meetings/[meetingId]/transcribe/route.ts"),
    "utf8",
  );
  const device = fs.readFileSync(path.join(root, ROUTE), "utf8");
  for (const [name, source] of [
    ["transcribe", transcribe],
    ["transcript", device],
  ]) {
    assert.match(
      source,
      /from "@\/lib\/transcription\/after-transcript"/,
      `${name} route imports the shared steps`,
    );
    assert.doesNotMatch(
      source,
      /\.list\(/,
      `${name} route does not enumerate storage itself`,
    );
    assert.doesNotMatch(
      source,
      /generateMeetingSuggestions\(/,
      `${name} route does not call extraction directly`,
    );
  }
});

test("an endless body without a Content-Length is cut off at 2 MB and the stream is cancelled", async () => {
  reset();
  let pulled = 0;
  let cancelled = false;
  const endless = new ReadableStream({
    pull(controller) {
      pulled += 65536;
      controller.enqueue(new Uint8Array(65536).fill(32));
    },
    cancel() {
      cancelled = true;
    },
  });
  const { status, body } = await post("", { "content-length": "" }, endless);
  assert.equal(status, 413);
  assert.equal(body.code, "payload_too_large");
  assert.equal(cancelled, true, "the reader is cancelled");
  assert.ok(pulled <= 2 * 1024 * 1024 + 2 * 65536, `read ${pulled} bytes`);
  assert.equal(claimed(), false);
});
