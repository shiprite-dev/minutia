import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-ai-openai-compat-"));
const bundled = path.join(tempDir, "openai-compatible.mjs");

await esbuild.build({
  entryPoints: ["src/lib/ai/providers/openai-compatible.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});

const { callOpenAiCompatible } = await import(pathToFileURL(bundled).href);

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const okJson = { choices: [{ message: { content: '{"result":1}' } }] };

test("success: calls correct URL, sends bearer + body, returns parsed json", async () => {
  let capturedUrl;
  let capturedOptions;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return { ok: true, status: 200, async json() { return okJson; } };
  };

  const result = await callOpenAiCompatible({
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o",
    system: "You are a helper.",
    prompt: "Say hello.",
    timeoutMs: 5000,
  });

  assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
  assert.ok(capturedOptions.headers["Authorization"].startsWith("Bearer "), "Authorization header must be Bearer");
  assert.equal(capturedOptions.headers["Authorization"], "Bearer sk-test");

  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.model, "gpt-4o");
  assert.deepEqual(body.messages, [
    { role: "system", content: "You are a helper." },
    { role: "user", content: "Say hello." },
  ]);
  assert.deepEqual(body.response_format, { type: "json_object" });

  assert.deepEqual(result, okJson);
});

test("trailing slash on baseUrl produces no double slash in request URL", async () => {
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return { ok: true, status: 200, async json() { return okJson; } };
  };

  await callOpenAiCompatible({
    baseUrl: "https://openrouter.ai/api/v1/",
    apiKey: "k",
    model: "m",
    system: "s",
    prompt: "p",
    timeoutMs: 5000,
  });

  assert.ok(!capturedUrl.includes("//chat"), `URL should not have double slash: ${capturedUrl}`);
  assert.ok(capturedUrl.endsWith("/chat/completions"), `URL must end with /chat/completions: ${capturedUrl}`);
});

test("throws 'Provider request failed: 500' when response.ok is false", async () => {
  globalThis.fetch = async () => {
    return { ok: false, status: 500, async json() { return {}; } };
  };

  await assert.rejects(
    callOpenAiCompatible({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "k",
      model: "m",
      system: "s",
      prompt: "p",
      timeoutMs: 5000,
    }),
    /Provider request failed: 500/
  );
});

test("SSRF: http://example.com throws Invalid AI base URL without calling fetch", async () => {
  let fetchCallCount = 0;
  globalThis.fetch = async () => {
    fetchCallCount++;
    return { ok: true, status: 200, async json() { return okJson; } };
  };

  await assert.rejects(
    callOpenAiCompatible({
      baseUrl: "http://example.com",
      apiKey: "k",
      model: "m",
      system: "s",
      prompt: "p",
      timeoutMs: 5000,
    }),
    /Invalid AI base URL/
  );

  assert.equal(fetchCallCount, 0, "fetch must NOT be called for blocked base URLs");
});
