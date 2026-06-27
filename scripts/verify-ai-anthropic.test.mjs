import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-ai-anthropic-"));
const bundled = path.join(tempDir, "anthropic.mjs");

await esbuild.build({
  entryPoints: ["src/lib/ai/providers/anthropic.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});

const { callAnthropic } = await import(pathToFileURL(bundled).href);

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const okJson = { content: [{ type: "text", text: "hello" }] };

test("success: calls correct URL, sends x-api-key + anthropic-version, body has top-level system + messages, returns parsed json", async () => {
  let capturedUrl;
  let capturedOptions;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return { ok: true, status: 200, async json() { return okJson; } };
  };

  const result = await callAnthropic({
    apiKey: "sk-ant-test",
    model: "claude-3-5-haiku-20241022",
    system: "You are a helpful assistant.",
    prompt: "Say hello.",
    timeoutMs: 5000,
  });

  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(capturedOptions.headers["x-api-key"], "sk-ant-test");
  assert.equal(capturedOptions.headers["anthropic-version"], "2023-06-01");
  assert.equal(capturedOptions.headers["content-type"], "application/json");

  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.model, "claude-3-5-haiku-20241022");
  assert.equal(body.max_tokens, 1024, "default max_tokens should be 1024");
  assert.equal(body.system, "You are a helpful assistant.", "system must be top-level field");
  assert.deepEqual(body.messages, [{ role: "user", content: "Say hello." }]);

  assert.deepEqual(result, okJson);
});

test("custom maxTokens honored in body", async () => {
  let capturedBody;
  globalThis.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, status: 200, async json() { return okJson; } };
  };

  await callAnthropic({
    apiKey: "k",
    model: "m",
    system: "s",
    prompt: "p",
    timeoutMs: 5000,
    maxTokens: 2048,
  });

  assert.equal(capturedBody.max_tokens, 2048);
});

test("throws 'Provider request failed: 529' when response.ok is false", async () => {
  globalThis.fetch = async () => {
    return { ok: false, status: 529, async json() { return {}; } };
  };

  await assert.rejects(
    callAnthropic({
      apiKey: "k",
      model: "m",
      system: "s",
      prompt: "p",
      timeoutMs: 5000,
    }),
    /Provider request failed: 529/
  );
});
