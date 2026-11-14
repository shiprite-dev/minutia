import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the transcription router so node:test exercises the real retry loop
// with a stubbed fetch (repo pattern, see verify-transcription-client).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-transcription-budget-"));
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
  BUDGET_LIMITS,
  createRunBudget,
  classifyFailure,
  nextDecision,
  recordAttempt,
  backoffMs,
  transcribeAudio,
  transcribeWithGroq,
  transcribeWithAssemblyAI,
  TranscriptionError,
} = await import(pathToFileURL(bundled).href);

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function audioBlob(bytes = 8, type = "audio/webm") {
  return new Blob([new Uint8Array(bytes)], { type });
}

function fakeFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options, calls.length);
  };
  return calls;
}

function okResponse(body) {
  return { ok: true, status: 200, async json() { return body; } };
}
function errResponse(status, headers = {}) {
  return {
    ok: false,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async text() { return `err ${status}`; },
    async json() { return {}; },
  };
}

// ---------------------------------------------------------------------------
// Decision ladder
// ---------------------------------------------------------------------------

test("the budget exhausts after three attempts across providers", () => {
  const budget = createRunBudget();
  recordAttempt(budget, "groq", "first");
  assert.equal(nextDecision(budget, "groq", "transient"), "retry_same");

  recordAttempt(budget, "groq", "retry");
  assert.equal(nextDecision(budget, "groq", "transient"), "switch_provider");

  recordAttempt(budget, "openrouter", "switch");
  assert.equal(budget.totalAttempts, BUDGET_LIMITS.maxAttempts);
  assert.equal(nextDecision(budget, "openrouter", "transient"), "stop");
});

test("auth and config failures never retry the same provider", () => {
  const auth = new TranscriptionError("no_api_key", "missing key");
  const config = new TranscriptionError("provider_not_configured", "not configured");
  assert.equal(classifyFailure(auth), "auth_or_config");
  assert.equal(classifyFailure(config), "auth_or_config");

  const budget = createRunBudget();
  recordAttempt(budget, "groq", "first");
  assert.equal(nextDecision(budget, "groq", classifyFailure(auth)), "switch_provider");
});

test("invalid input switches providers instead of retrying", () => {
  const invalid = new TranscriptionError("unsupported_format", "bad audio");
  assert.equal(classifyFailure(invalid), "invalid_input");
  const budget = createRunBudget();
  recordAttempt(budget, "groq", "first");
  assert.equal(nextDecision(budget, "groq", classifyFailure(invalid)), "switch_provider");
});

test("a 429 retries the same provider once, then switches", () => {
  const rateLimited = new TranscriptionError("rate_limit", "slow down");
  assert.equal(classifyFailure(rateLimited), "transient");

  const budget = createRunBudget();
  recordAttempt(budget, "groq", "first");
  assert.equal(nextDecision(budget, "groq", "transient"), "retry_same");

  recordAttempt(budget, "groq", "retry");
  assert.equal(nextDecision(budget, "groq", "transient"), "switch_provider");
});

test("the switch cap stops after one provider switch", () => {
  const budget = createRunBudget();
  recordAttempt(budget, "groq", "first");
  assert.equal(nextDecision(budget, "groq", "auth_or_config"), "switch_provider");

  recordAttempt(budget, "openrouter", "switch");
  assert.equal(budget.providerSwitches, BUDGET_LIMITS.maxSwitches);
  assert.equal(nextDecision(budget, "openrouter", "auth_or_config"), "stop");
  // The newly reached provider still gets its own one same-provider retry,
  // which is the final attempt under the total cap.
  assert.equal(nextDecision(budget, "openrouter", "transient"), "retry_same");
  recordAttempt(budget, "openrouter", "retry");
  assert.equal(nextDecision(budget, "openrouter", "transient"), "stop");
});

test("cancellation stops immediately and is classified from abort errors", () => {
  assert.equal(classifyFailure(Object.assign(new Error("aborted"), { name: "AbortError" })), "cancelled");
  assert.equal(classifyFailure(new TranscriptionError("timeout", "timed out")), "transient");

  const budget = createRunBudget();
  recordAttempt(budget, "groq", "first");
  assert.equal(nextDecision(budget, "groq", "cancelled"), "stop");
});

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

test("backoff doubles from 500ms and caps at 8s", () => {
  const flat = () => 0.5;
  assert.equal(backoffMs(0, null, undefined, flat), 500);
  assert.equal(backoffMs(1, null, undefined, flat), 1000);
  assert.equal(backoffMs(2, null, undefined, flat), 2000);
  assert.equal(backoffMs(3, null, undefined, flat), 4000);
  assert.equal(backoffMs(4, null, undefined, flat), 8000);
  assert.equal(backoffMs(10, null, undefined, flat), 8000);
  assert.equal(backoffMs(10, null, undefined, () => 1), 8000, "jitter cannot push past the cap");
});

test("backoff honors Retry-After as a floor and clamps to the remaining budget", () => {
  const flat = () => 0.5;
  assert.equal(backoffMs(0, 3000, undefined, flat), 3000, "Retry-After overrides the smaller base delay");
  assert.equal(backoffMs(0, 3000, 1000, flat), 1000, "remaining budget wins over Retry-After");
  assert.equal(backoffMs(0, null, 100, flat), 100, "clamped to remaining");
  assert.equal(backoffMs(0, null, 0, flat), 0, "an exhausted budget never waits");
  assert.equal(backoffMs(0, null, -5, flat), 0, "never negative");
  assert.equal(backoffMs(0, 0, undefined, flat), 500, "a zero Retry-After is not a floor");
});

test("jitter stays within twenty percent of the base delay", () => {
  const low = backoffMs(0, null, undefined, () => 0);
  const mid = backoffMs(0, null, undefined, () => 0.5);
  const high = backoffMs(0, null, undefined, () => 1);
  assert.equal(low, 400);
  assert.equal(mid, 500);
  assert.equal(high, 600);
  for (const value of [low, mid, high]) {
    assert.ok(value >= 400 && value <= 600, `${value} must stay within +-20 percent of 500`);
  }
});

// ---------------------------------------------------------------------------
// Retry-After capture
// ---------------------------------------------------------------------------

test("a 429 response's Retry-After seconds are captured on the typed error", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "slow down" }), {
      status: 429,
      headers: { "retry-after": "2" },
    });
  await assert.rejects(transcribeWithGroq(audioBlob(), { apiKey: "k" }), (err) => {
    assert.ok(err instanceof TranscriptionError);
    assert.equal(err.code, "rate_limit");
    assert.equal(err.retryAfterMs, 2000);
    return true;
  });
});

test("a 429 response's HTTP-date Retry-After is captured as a positive delay", async () => {
  const at = new Date(Date.now() + 5000).toUTCString();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "slow down" }), {
      status: 429,
      headers: { "retry-after": at },
    });
  await assert.rejects(transcribeWithGroq(audioBlob(), { apiKey: "k" }), (err) => {
    assert.ok(err instanceof TranscriptionError);
    assert.ok(err.retryAfterMs > 0 && err.retryAfterMs <= 5000, `unexpected ${err.retryAfterMs}`);
    return true;
  });
});

test("non-positive and unparsable Retry-After values produce no delay", async () => {
  for (const value of ["0", "-5", "soon"]) {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), { status: 429, headers: { "retry-after": value } });
    await assert.rejects(transcribeWithGroq(audioBlob(), { apiKey: "k" }), (err) => {
      assert.equal(err.retryAfterMs, undefined, `${value} must not produce a delay`);
      return true;
    });
  }
});

test("a positive sub-millisecond Retry-After still yields at least 1ms", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({}), { status: 429, headers: { "retry-after": "0.0001" } });
  await assert.rejects(transcribeWithGroq(audioBlob(), { apiKey: "k" }), (err) => {
    assert.equal(err.retryAfterMs, 1);
    return true;
  });
});

// ---------------------------------------------------------------------------
// Router integration
// ---------------------------------------------------------------------------

test("transcribeAudio re-sends the same provider after a transient failure", async () => {
  const env = { TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" };
  const calls = fakeFetch((url, _options, n) =>
    n === 1 ? errResponse(429) : okResponse({ text: "recovered", usage: { seconds: 1 } })
  );
  const result = await transcribeAudio(audioBlob(), { env, deadlineAt: Date.now() + 250 });

  assert.equal(result.provider, "groq");
  assert.equal(result.text, "recovered");
  assert.equal(calls.length, 2, "the same provider request must actually be re-sent");
  assert.equal(calls[0].url, calls[1].url);
});

test("transcribeAudio switches providers after the retry budget for one provider is spent", async () => {
  const env = { TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" };
  const calls = fakeFetch((url) =>
    url.includes("groq.com")
      ? errResponse(429)
      : okResponse({ text: "saved by fallback", usage: { seconds: 1 } })
  );
  const result = await transcribeAudio(audioBlob(), { env, deadlineAt: Date.now() + 250 });

  assert.equal(result.provider, "openrouter");
  assert.equal(result.text, "saved by fallback");
  assert.equal(calls.length, 3, "groq first, groq retry, then openrouter");
  assert.ok(calls[0].url.includes("groq.com"));
  assert.ok(calls[1].url.includes("groq.com"));
  assert.ok(calls[2].url.includes("openrouter.ai"));
});

test("a 401 switches providers without ever retrying the rejected credential", async () => {
  const env = { TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "bad", OPENROUTER_API_KEY: "o" };
  const calls = fakeFetch((url) =>
    url.includes("groq.com")
      ? errResponse(401)
      : okResponse({ text: "fallback after auth failure", usage: { seconds: 1 } })
  );
  const result = await transcribeAudio(audioBlob(), { env, deadlineAt: Date.now() + 250 });

  assert.equal(result.provider, "openrouter");
  assert.equal(calls.length, 2, "one groq attempt then one openrouter attempt, no same-provider retry");
  assert.ok(calls[0].url.includes("groq.com"));
  assert.ok(calls[1].url.includes("openrouter.ai"));
});

test("a 403 is classified as an auth failure, not a transient one", async () => {
  const env = { TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "bad" };
  fakeFetch(() => errResponse(403));
  await assert.rejects(transcribeAudio(audioBlob(), { env, deadlineAt: Date.now() + 250 }), (error) => {
    assert.equal(error.code, "auth_error");
    return true;
  });
});

test("transcribeAudio never retries after the caller signal aborts", async () => {
  const env = { TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" };
  const controller = new AbortController();
  const calls = fakeFetch(() => {
    controller.abort();
    return errResponse(429);
  });
  await assert.rejects(
    transcribeAudio(audioBlob(), { env, signal: controller.signal, deadlineAt: Date.now() + 250 })
  );
  assert.equal(calls.length, 1, "an aborted caller gets no retry and no fallback");
});

test("transcribeAudio makes no request at all for an already-aborted caller", async () => {
  const env = { TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" };
  const controller = new AbortController();
  controller.abort();
  const calls = fakeFetch(() => okResponse({ text: "x" }));
  await assert.rejects(transcribeAudio(audioBlob(), { env, signal: controller.signal }));
  assert.equal(calls.length, 0);
});

test("transcribeAudio stops during backoff when the caller aborts", async () => {
  const env = { TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g" };
  const controller = new AbortController();
  const calls = fakeFetch(() => errResponse(429));
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    transcribeAudio(audioBlob(), {
      env,
      signal: controller.signal,
      deadlineAt: Date.now() + 10000,
    })
  );
  assert.equal(calls.length, 1, "no request may be sent after the abort");
});

test("transcribeAudio waits out the Retry-After floor before re-sending", async () => {
  const env = { TRANSCRIPTION_PROVIDER: "groq", GROQ_API_KEY: "g" };
  const calls = fakeFetch((_url, _options, n) =>
    n === 1 ? errResponse(429, { "retry-after": "1" }) : okResponse({ text: "ok" })
  );
  const started = Date.now();
  const result = await transcribeAudio(audioBlob(), { env, deadlineAt: Date.now() + 10000 });
  const elapsed = Date.now() - started;

  assert.equal(result.provider, "groq");
  assert.equal(calls.length, 2);
  assert.ok(elapsed >= 900, `waited ${elapsed}ms, expected the 1s Retry-After floor`);
});

test("a pre-aborted caller signal aborts the inner request signal", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls = fakeFetch((_url, options) => {
    if (options.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return okResponse({ text: "x" });
  });
  await assert.rejects(
    transcribeWithGroq(audioBlob(), { apiKey: "k", signal: controller.signal }),
    (err) => err instanceof TranscriptionError && err.code === "timeout"
  );
  assert.equal(calls[0].options.signal.aborted, true, "the inner request signal must already be aborted");
});

test("AssemblyAI bounds a hung response body by the deadline", async () => {
  globalThis.fetch = async (_url, init = {}) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    async text() { return ""; },
    json() {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        );
      });
    },
  });
  await assert.rejects(
    transcribeWithAssemblyAI(audioBlob(), { apiKey: "k", timeoutMs: 50 }),
    (err) => err instanceof TranscriptionError && err.code === "timeout"
  );
});
