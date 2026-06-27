import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-ai-call-"));
const bundled = path.join(tempDir, "call.mjs");

await esbuild.build({
  entryPoints: ["src/lib/ai/call.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});

const { dispatchAi, AiNotConfiguredError } = await import(pathToFileURL(bundled).href);

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const openaiConfig = {
  provider: "openai-compatible",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "sk-test",
  model: "google/gemini-flash",
};

const anthropicConfig = {
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  apiKey: "sk-ant-test",
  model: "claude-3-5-haiku-20241022",
};

const openaiOkBody = { choices: [{ message: { content: '{"ok":true}' } }] };

test("openai-compatible: fetch hits /chat/completions, data is raw completion, model matches config", async () => {
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return { ok: true, status: 200, async json() { return openaiOkBody; } };
  };

  const result = await dispatchAi(openaiConfig, { system: "s", prompt: "p", retries: 0 });

  assert.ok(capturedUrl.endsWith("/chat/completions"), `URL must end with /chat/completions: ${capturedUrl}`);
  assert.deepEqual(result.data, openaiOkBody);
  assert.equal(result.model, openaiConfig.model);
});

test("anthropic: fetch hits https://api.anthropic.com/v1/messages, data is wrapped in choices envelope", async () => {
  let capturedUrl;
  const anthropicBody = { content: [{ type: "text", text: '{"x":1}' }] };
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return { ok: true, status: 200, async json() { return anthropicBody; } };
  };

  const result = await dispatchAi(anthropicConfig, { system: "s", prompt: "p", retries: 0 });

  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(result.data.choices[0].message.content, '{"x":1}');
  assert.equal(result.model, anthropicConfig.model);
});

test("retry: first fetch throws, second ok -> resolves and fetch called twice", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) throw new Error("network error");
    return { ok: true, status: 200, async json() { return openaiOkBody; } };
  };

  const result = await dispatchAi(openaiConfig, { system: "s", prompt: "p", retries: 1 });

  assert.deepEqual(result.data, openaiOkBody);
  assert.equal(callCount, 2);
});

test("exhaustion: all attempts fail -> dispatchAi rejects", async () => {
  globalThis.fetch = async () => {
    throw new Error("always fails");
  };

  await assert.rejects(
    dispatchAi(openaiConfig, { system: "s", prompt: "p", retries: 1 }),
    /always fails/
  );
});
