import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "minutia-transcription-language-"),
);
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
  getProviderChain,
  normalizeLanguageHint,
  providerModel,
  providerSupportsLanguage,
  selectChainForLanguage,
  transcribeAudio,
  transcribeWithGroq,
  TranscriptionError,
} = await import(pathToFileURL(bundled).href);

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

const ENGLISH_ONLY_MODEL = "moondream/parakeet-ultra";
const OPENROUTER_ENGLISH_ONLY = {
  TRANSCRIPTION_PROVIDER: "openrouter",
  OPENROUTER_API_KEY: "o",
  OPENROUTER_STT_MODEL: ENGLISH_ONLY_MODEL,
};
const WITH_GROQ = { ...OPENROUTER_ENGLISH_ONLY, GROQ_API_KEY: "g" };

function audioBlob() {
  return new Blob([new Uint8Array(8)], { type: "audio/webm" });
}

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
const fail = (status) => ({
  ok: false,
  status,
  async text() {
    return `err ${status}`;
  },
  async json() {
    return {};
  },
});
const isGroq = (url) => url.includes("groq.com");
const isOpenRouter = (url) => url.includes("openrouter.ai");

test("an English-only OpenRouter model never claims Japanese", () => {
  assert.equal(
    providerSupportsLanguage("openrouter", "ja", OPENROUTER_ENGLISH_ONLY),
    false,
  );
  assert.equal(
    providerSupportsLanguage("openrouter", "en", OPENROUTER_ENGLISH_ONLY),
    true,
  );
  assert.equal(
    providerSupportsLanguage("openrouter", "ja", { OPENROUTER_API_KEY: "o" }),
    true,
  );
  assert.equal(providerSupportsLanguage("groq", "ja", WITH_GROQ), true);
});

test("a browser locale with a region resolves to its language", () => {
  assert.equal(normalizeLanguageHint("ja-JP"), "ja");
  assert.equal(normalizeLanguageHint("en_US"), "en");
  assert.equal(normalizeLanguageHint("xx-YY"), null);
});

test("OpenRouter as primary appends Groq as fallback", () => {
  assert.deepEqual(getProviderChain(WITH_GROQ), ["openrouter", "groq"]);
  assert.deepEqual(getProviderChain(OPENROUTER_ENGLISH_ONLY), ["openrouter"]);
});

test("a Japanese meeting skips the English-only primary and transcribes on Groq", async () => {
  const calls = fakeFetch((url) => {
    if (isOpenRouter(url))
      throw new Error(
        "an English-only model must never receive Japanese audio",
      );
    return ok({ text: "こんにちは", duration: 2 });
  });
  const result = await transcribeAudio(audioBlob(), {
    env: WITH_GROQ,
    languageHint: "ja",
  });
  assert.equal(result.provider, "groq");
  assert.equal(result.text, "こんにちは");
  assert.equal(calls.length, 1);
  assert.ok(isGroq(calls[0].url));
});

test("an English meeting uses the configured primary with its configured model", async () => {
  const calls = fakeFetch((url) =>
    isOpenRouter(url)
      ? ok({ text: "hello", usage: { seconds: 2 } })
      : fail(500),
  );
  const result = await transcribeAudio(audioBlob(), {
    env: WITH_GROQ,
    languageHint: "en",
  });
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, ENGLISH_ONLY_MODEL);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).model, ENGLISH_ONLY_MODEL);
});

test("a 402 from the primary falls through to Groq without retrying the primary", async () => {
  const calls = fakeFetch((url) =>
    isOpenRouter(url) ? fail(402) : ok({ text: "rescued", duration: 1 }),
  );
  const result = await transcribeAudio(audioBlob(), {
    env: WITH_GROQ,
    languageHint: "en",
  });
  assert.equal(result.provider, "groq");
  assert.equal(result.text, "rescued");
  assert.deepEqual(
    calls.map((c) => (isGroq(c.url) ? "groq" : "openrouter")),
    ["openrouter", "groq"],
  );
});

test("a 503 from the primary falls through to Groq", async () => {
  const calls = fakeFetch((url) =>
    isOpenRouter(url) ? fail(503) : ok({ text: "rescued", duration: 1 }),
  );
  const result = await transcribeAudio(audioBlob(), {
    env: WITH_GROQ,
    languageHint: "en",
    deadlineAt: Date.now() + 250,
  });
  assert.equal(result.provider, "groq");
  assert.ok(isGroq(calls.at(-1).url));
});

test("a language every configured model explicitly excludes fails as unsupported without calling any provider", async () => {
  const calls = fakeFetch(() => ok({ text: "garbage" }));
  await assert.rejects(
    transcribeAudio(audioBlob(), {
      env: OPENROUTER_ENGLISH_ONLY,
      languageHint: "ja",
    }),
    (err) => {
      assert.ok(err instanceof TranscriptionError);
      assert.equal(err.code, "unsupported_language");
      return true;
    },
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(
    selectChainForLanguage(["openrouter"], "ja", OPENROUTER_ENGLISH_ONLY),
    [],
  );
});

test("zero-config default transcribes a Japanese meeting on Groq", async () => {
  const calls = fakeFetch(() => ok({ text: "はい", duration: 1 }));
  const result = await transcribeAudio(audioBlob(), {
    env: { GROQ_API_KEY: "g" },
    languageHint: "ja",
  });
  assert.equal(result.provider, "groq");
  assert.equal(calls.length, 1);
  assert.ok(isGroq(calls[0].url));
});

test("Whisper segments at or above the no-speech threshold are dropped from text and timings", async () => {
  fakeFetch(() =>
    ok({
      text: " Hello there. Thank you. How are you?",
      duration: 9,
      segments: [
        { start: 0, end: 2, text: " Hello there.", no_speech_prob: 0.59 },
        { start: 3, end: 5, text: " Thank you.", no_speech_prob: 0.6 },
        { start: 6, end: 9, text: " How are you?", no_speech_prob: 0.02 },
      ],
    }),
  );
  const result = await transcribeWithGroq(audioBlob(), { apiKey: "g" });
  assert.equal(result.text, "Hello there. How are you?");
  assert.equal(result.outcome, "speech");
  assert.deepEqual(
    result.timed.map((s) => s.text),
    ["Hello there.", "How are you?"],
  );
});

test("an all-silence recording returns no speech instead of a hallucinated line", async () => {
  fakeFetch(() =>
    ok({
      text: " Thank you.",
      duration: 30,
      segments: [
        { start: 0, end: 30, text: " Thank you.", no_speech_prob: 0.95 },
      ],
    }),
  );
  const result = await transcribeWithGroq(audioBlob(), { apiKey: "g" });
  assert.equal(result.text, "");
  assert.equal(result.outcome, "no_speech");
  assert.ok(!result.timed?.length);
});

test("only a declared model language list hard-excludes; the broad table still falls back", () => {
  assert.deepEqual(
    selectChainForLanguage(["assemblyai", "openrouter"], "cy", OPENROUTER_ENGLISH_ONLY),
    ["assemblyai"]
  );
  assert.deepEqual(selectChainForLanguage(["assemblyai"], "sv-SE", {}), ["assemblyai"]);
});

test("an AssemblyAI-only workspace still transcribes a Swedish meeting on AssemblyAI", async () => {
  const calls = fakeFetch(() => fail(500));
  await assert.rejects(
    transcribeAudio(audioBlob(), {
      env: { TRANSCRIPTION_PROVIDER: "assemblyai", ASSEMBLYAI_API_KEY: "a" },
      languageHint: "sv-SE",
      deadlineAt: Date.now() + 250,
    }),
    (err) => {
      assert.ok(err instanceof TranscriptionError);
      assert.notEqual(err.code, "unsupported_language");
      assert.notEqual(err.code, "provider_not_configured");
      return true;
    }
  );
  assert.ok(calls.length > 0);
  assert.ok(calls[0].url.includes("assemblyai"));
});

test("without a language hint the English-only primary keeps the unchanged chain", async () => {
  const calls = fakeFetch((url) =>
    isOpenRouter(url) ? ok({ text: "hello", usage: { seconds: 1 } }) : fail(500)
  );
  const result = await transcribeAudio(audioBlob(), { env: WITH_GROQ });
  assert.equal(result.provider, "openrouter");
  assert.equal(calls.length, 1);
});

test("model language keys ignore case and a routing suffix", () => {
  const env = { OPENROUTER_API_KEY: "o", OPENROUTER_STT_MODEL: "moondream/Parakeet-Ultra:nitro" };
  assert.equal(providerSupportsLanguage("openrouter", "ja", env), false);
  assert.equal(providerSupportsLanguage("openrouter", "en", env), true);
});

test("providerModel names a model only for OpenRouter and Groq", () => {
  assert.equal(providerModel("openrouter", {}), "openai/whisper-1");
  assert.equal(providerModel("openrouter", { OPENROUTER_STT_MODEL: ENGLISH_ONLY_MODEL }), ENGLISH_ONLY_MODEL);
  assert.equal(providerModel("groq", {}), "whisper-large-v3-turbo");
  assert.equal(providerModel("assemblyai", {}), undefined);
  assert.equal(providerModel("local", {}), undefined);
  assert.equal(providerModel("deepgram", {}), undefined);
});

test("a rebuild that leaves only empty text is no speech with no timings", async () => {
  fakeFetch(() =>
    ok({
      text: " Thank you.",
      duration: 10,
      segments: [
        { start: 0, end: 5, text: " Thank you.", no_speech_prob: 0.9 },
        { start: 5, end: 10, text: "" },
      ],
    })
  );
  const result = await transcribeWithGroq(audioBlob(), { apiKey: "g" });
  assert.equal(result.text, "");
  assert.equal(result.outcome, "no_speech");
  assert.ok(!result.timed?.length);
});
