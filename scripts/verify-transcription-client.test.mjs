import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the transcription lib so node:test can exercise the pure logic and the
// provider clients with a mocked fetch (repo pattern, see verify-openrouter-client).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-transcription-"));
const bundled = path.join(tempDir, "transcription.mjs");
await esbuild.build({
  entryPoints: ["src/lib/transcription/index.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const {
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL,
  transcribeWithGroq,
  transcribeWithOpenRouter,
  resolveTranscriptionProvider,
  getProviderChain,
  isTranscriptionConfigured,
  transcribeAudio,
  TranscriptionError,
  MAX_TRANSCRIPTION_BYTES,
  needsChunking,
  findWebmClusterOffsets,
  planWebmChunks,
  chunkAudioBlob,
} = await import(pathToFileURL(bundled).href);

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function audioBlob(bytes = 8, type = "audio/webm") {
  return new Blob([new Uint8Array(bytes)], { type });
}

// A fake fetch that records the request and returns/throws per the scenario.
function fakeFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  return calls;
}

function okResponse(body) {
  return { ok: true, status: 200, async json() { return body; } };
}
function errResponse(status) {
  return { ok: false, status, async text() { return `err ${status}`; }, async json() { return {}; } };
}

// ---------------------------------------------------------------------------
// Groq client
// ---------------------------------------------------------------------------

test("transcribeWithGroq posts multipart audio to the OpenAI-compatible endpoint", async () => {
  const calls = fakeFetch(() => okResponse({ text: "hello world", duration: 12.5 }));
  const result = await transcribeWithGroq(audioBlob(64), { apiKey: "groq-key" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${GROQ_BASE_URL}/audio/transcriptions`);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer groq-key");

  const form = calls[0].options.body;
  assert.equal(typeof form.get, "function", "body must be FormData");
  assert.equal(form.get("model"), GROQ_DEFAULT_MODEL);
  assert.ok(form.get("file"), "form must carry the audio file");

  assert.deepEqual(result, {
    text: "hello world",
    model: GROQ_DEFAULT_MODEL,
    provider: "groq",
    durationSeconds: 12.5,
  });
});

test("transcribeWithGroq honors an explicit model override", async () => {
  const calls = fakeFetch(() => okResponse({ text: "x" }));
  const result = await transcribeWithGroq(audioBlob(), { apiKey: "k", model: "whisper-large-v3-turbo" });
  assert.equal(calls[0].options.body.get("model"), "whisper-large-v3-turbo");
  assert.equal(result.model, "whisper-large-v3-turbo");
  assert.equal(result.durationSeconds, null, "missing duration becomes null");
});

test("transcribeWithGroq maps HTTP errors to typed transcription errors", async () => {
  for (const [status, code] of [
    [429, "rate_limit"],
    [400, "unsupported_format"],
    [415, "unsupported_format"],
    [500, "provider_error"],
  ]) {
    fakeFetch(() => errResponse(status));
    await assert.rejects(
      transcribeWithGroq(audioBlob(), { apiKey: "k" }),
      (err) => {
        assert.ok(err instanceof TranscriptionError, "must be a TranscriptionError");
        assert.equal(err.code, code, `status ${status} -> ${code}`);
        assert.equal(err.status, status);
        return true;
      }
    );
  }
});

test("transcribeWithGroq maps an aborted/timed-out request to a timeout error", async () => {
  globalThis.fetch = (_url, options = {}) =>
    new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      );
    });
  await assert.rejects(
    transcribeWithGroq(audioBlob(), { apiKey: "k", timeoutMs: 5 }),
    (err) => {
      assert.ok(err instanceof TranscriptionError);
      assert.equal(err.code, "timeout");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// OpenRouter STT client (OpenAI-compatible fallback)
// ---------------------------------------------------------------------------

test("transcribeWithOpenRouter posts base64 JSON with attribution headers", async () => {
  // OpenRouter STT is JSON + base64 (input_audio), not OpenAI-style multipart.
  const calls = fakeFetch(() => okResponse({ text: "fallback text", usage: { seconds: 3 } }));
  const result = await transcribeWithOpenRouter(audioBlob(64), { apiKey: "or-key", mimeType: "audio/webm" });

  assert.match(calls[0].url, /\/audio\/transcriptions$/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer or-key");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.ok(calls[0].options.headers["X-Title"], "should send the X-Title attribution header");

  const body = JSON.parse(calls[0].options.body);
  assert.equal(typeof body.input_audio.data, "string");
  assert.ok(body.input_audio.data.length > 0, "audio is sent as base64");
  assert.equal(body.input_audio.format, "webm");

  assert.equal(result.provider, "openrouter");
  assert.equal(result.text, "fallback text");
  assert.equal(result.durationSeconds, 3); // from usage.seconds
});

// ---------------------------------------------------------------------------
// Provider resolution + fallback chain
// ---------------------------------------------------------------------------

test("resolveTranscriptionProvider defaults to groq and validates the enum", () => {
  assert.equal(resolveTranscriptionProvider({}), "groq");
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "openrouter" }), "openrouter");
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "deepgram" }), "deepgram");
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "local" }), "local");
  // Unknown values fall back to the default rather than poisoning the pipeline.
  assert.equal(resolveTranscriptionProvider({ TRANSCRIPTION_PROVIDER: "bogus" }), "groq");
});

test("getProviderChain puts the configured provider first and adds OpenRouter as fallback", () => {
  assert.deepEqual(
    getProviderChain({ TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" }),
    ["groq", "openrouter"]
  );
  // No OpenRouter key -> no fallback appended.
  assert.deepEqual(
    getProviderChain({ TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g" }),
    ["groq"]
  );
  // OpenRouter primary is its own fallback; never duplicated.
  assert.deepEqual(
    getProviderChain({ TRANSCRIPTION_PROVIDER: "openrouter", OPENROUTER_API_KEY: "o" }),
    ["openrouter"]
  );
});

test("isTranscriptionConfigured reflects whether any usable provider key exists", () => {
  assert.equal(isTranscriptionConfigured({ TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g" }), true);
  assert.equal(isTranscriptionConfigured({ TRANSCRIPTION_PROVIDER: "groq", OPENROUTER_API_KEY: "o" }), true);
  assert.equal(isTranscriptionConfigured({ TRANSCRIPTION_PROVIDER: "groq" }), false);
  // deepgram/local are not implemented, so they only count if OpenRouter can cover.
  assert.equal(isTranscriptionConfigured({ TRANSCRIPTION_PROVIDER: "local" }), false);
  assert.equal(isTranscriptionConfigured({ TRANSCRIPTION_PROVIDER: "local", OPENROUTER_API_KEY: "o" }), true);
});

test("transcribeAudio falls back from a failing primary to OpenRouter", async () => {
  const env = { TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" };
  const calls = fakeFetch((url) =>
    url.includes("groq.com") ? errResponse(500) : okResponse({ text: "saved by fallback", usage: { seconds: 1 } })
  );
  const result = await transcribeAudio(audioBlob(), { env });
  assert.equal(result.provider, "openrouter");
  assert.equal(result.text, "saved by fallback");
  assert.equal(calls.length, 2, "tried groq, then openrouter");
});

test("transcribeAudio surfaces the primary provider's error, not the fallback's", async () => {
  const env = { TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" };
  // groq -> 415 (the actionable root cause: bad audio); openrouter -> 429 (noise).
  fakeFetch((url) => (url.includes("groq.com") ? errResponse(415) : errResponse(429)));
  await assert.rejects(transcribeAudio(audioBlob(), { env }), (err) => {
    assert.ok(err instanceof TranscriptionError);
    assert.equal(err.code, "unsupported_format", "the primary failure must win over the fallback's");
    return true;
  });
});

test("transcribeAudio surfaces a not-configured error when no provider key is usable", async () => {
  await assert.rejects(
    transcribeAudio(audioBlob(), { env: { TRANSCRIPTION_PROVIDER: "groq" } }),
    (err) => {
      assert.ok(err instanceof TranscriptionError);
      assert.equal(err.code, "provider_not_configured");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Chunking (>25MB long audio)
// ---------------------------------------------------------------------------

test("needsChunking triggers only past the size ceiling", () => {
  assert.equal(needsChunking(MAX_TRANSCRIPTION_BYTES), false);
  assert.equal(needsChunking(MAX_TRANSCRIPTION_BYTES + 1), true);
  assert.equal(needsChunking(10, 8), true);
});

// Build a synthetic WebM: [header][cluster][cluster][cluster].
function makeWebm(headerLen, clusterPayload, clusterCount) {
  const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
  const clusterLen = CLUSTER.length + clusterPayload;
  const total = headerLen + clusterLen * clusterCount;
  const buf = new Uint8Array(total);
  for (let i = 0; i < headerLen; i++) buf[i] = 0xa0 + (i % 16); // distinctive header bytes
  for (let c = 0; c < clusterCount; c++) {
    const at = headerLen + c * clusterLen;
    buf.set(CLUSTER, at);
    for (let i = 0; i < clusterPayload; i++) buf[at + CLUSTER.length + i] = c + 1;
  }
  return { buf, headerLen, clusterLen, clusterCount };
}

test("findWebmClusterOffsets locates every cluster start", () => {
  const { buf, headerLen, clusterLen, clusterCount } = makeWebm(4, 6, 3);
  const offsets = findWebmClusterOffsets(buf);
  assert.deepEqual(
    offsets,
    Array.from({ length: clusterCount }, (_, c) => headerLen + c * clusterLen)
  );
});

test("planWebmChunks prepends the init segment and respects the size cap", () => {
  // header=4, cluster=10 bytes; cap=24 fits two clusters per chunk (4+10+10).
  const { buf } = makeWebm(4, 6, 3);
  const header = buf.slice(0, 4);
  const chunks = planWebmChunks(buf, 24);

  assert.equal(chunks.length, 2, "3 clusters at 2-per-chunk -> two chunks");
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 24, "no chunk exceeds the cap");
    assert.deepEqual(chunk.slice(0, 4), header, "every chunk starts with the header");
    assert.deepEqual(Array.from(chunk.slice(4, 8)), [0x1f, 0x43, 0xb6, 0x75], "header is followed by a cluster");
  }
  assert.equal(chunks[0].length, 24); // header + 2 clusters
  assert.equal(chunks[1].length, 14); // header + 1 cluster
});

test("planWebmChunks emits an oversized single cluster rather than looping forever", () => {
  const { buf } = makeWebm(4, 6, 1); // one 10-byte cluster, cap below header+cluster
  const chunks = planWebmChunks(buf, 8);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 14);
});

test("chunkAudioBlob byte-windows a non-webm container in order", async () => {
  const blob = new Blob([new Uint8Array(25).map((_, i) => i)], { type: "audio/wav" });
  const chunks = await chunkAudioBlob(blob, "audio/wav", 10);
  assert.deepEqual(chunks.map((c) => c.size), [10, 10, 5]);

  const joined = new Uint8Array(await new Blob(chunks).arrayBuffer());
  assert.deepEqual(Array.from(joined), Array.from({ length: 25 }, (_, i) => i));
});

test("chunkAudioBlob returns the original blob untouched when under the cap", async () => {
  const blob = audioBlob(100);
  const chunks = await chunkAudioBlob(blob, "audio/webm", MAX_TRANSCRIPTION_BYTES);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].size, 100);
});

const claimMigration = fs
  .readdirSync(path.join(root, "supabase", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => fs.readFileSync(path.join(root, "supabase", "migrations", f), "utf8"))
  .join("\n");

const transcribeRoute = fs.readFileSync(
  path.join(root, "src/app/api/meetings/[meetingId]/transcribe/route.ts"),
  "utf8"
);

test("a migration defines the claim_meeting_transcription RPC", () => {
  assert.match(
    claimMigration,
    /create or replace function public\.claim_meeting_transcription/i,
    "claim RPC must exist in a migration"
  );
});

test("the claim RPC is SECURITY DEFINER and re-checks series access", () => {
  const fn = claimMigration.slice(
    claimMigration.toLowerCase().indexOf("function public.claim_meeting_transcription")
  );
  assert.match(fn, /security definer/i, "RPC must be SECURITY DEFINER");
  assert.match(fn, /user_can_access_series/i, "RPC must preserve authz");
  assert.match(fn, /is distinct from 'processing'/i, "RPC claims non-processing rows");
  assert.match(fn, /transcription_started_at\s*<\s*now\(\)/i, "RPC reclaims stale runs");
});

test("authenticated users can execute the claim RPC", () => {
  assert.match(
    claimMigration,
    /grant execute on function public\.claim_meeting_transcription[\s\S]*?to[\s\S]*?authenticated/i,
    "authenticated must be granted execute on the claim RPC"
  );
});

test("the transcribe route claims via the RPC, not an or() on UPDATE", () => {
  assert.match(
    transcribeRoute,
    /\.rpc\(\s*["']claim_meeting_transcription["']/,
    "route must call the claim RPC"
  );
  assert.ok(
    !/\.update\([\s\S]*?\.or\(/.test(transcribeRoute),
    "route must not use .or() on an UPDATE (broken on self-host PostgREST)"
  );
});
