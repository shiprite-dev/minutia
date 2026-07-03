import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-ai-stream-"));

async function bundle(entry, name) {
  const outfile = path.join(tempDir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [entry], outfile, bundle: true, platform: "node",
    format: "esm", logLevel: "silent", absWorkingDir: root,
  });
  return import(pathToFileURL(outfile).href);
}

const { streamOpenAiCompatible } = await bundle(
  "src/lib/ai/providers/openai-compatible-stream.ts", "provider"
);
const { streamAi } = await bundle("src/lib/ai/stream.ts", "stream");

// Build a Response whose body is a ReadableStream of the given string chunks.
function sseResponse(chunks, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status });
}

async function collect(iter) {
  const out = [];
  for await (const w of iter) out.push(w);
  return out;
}

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

test("streamOpenAiCompatible parses delta content across awkward chunk splits", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo "}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
  };
  const deltas = await collect(
    streamOpenAiCompatible({
      baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m",
      system: "s", prompt: "p", timeoutMs: 5000, reasoningEffort: "minimal",
    })
  );
  assert.equal(deltas.join(""), "Hello world");
  assert.ok(captured.url.endsWith("/chat/completions"));
  assert.equal(captured.body.stream, true);
  assert.equal(captured.body.reasoning_effort, "minimal");
});

test("streamOpenAiCompatible ignores keepalive lines and stops at [DONE]", async () => {
  globalThis.fetch = async () =>
    sseResponse([
      ": keepalive\n\n",
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
      "data: [DONE]\n\n",
      'data: {"choices":[{"delta":{"content":"B"}}]}\n\n',
    ]);
  const deltas = await collect(
    streamOpenAiCompatible({
      baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m",
      system: "s", prompt: "p", timeoutMs: 5000,
    })
  );
  assert.deepEqual(deltas, ["A"]);
});

test("streamAi routes openai-compatible config through the streaming provider", async () => {
  globalThis.fetch = async () =>
    sseResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', "data: [DONE]\n\n"]);
  const config = { provider: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m" };
  const deltas = await collect(streamAi({ system: "s", prompt: "p", config }));
  assert.deepEqual(deltas, ["hi"]);
});

test("streamAi falls back to a single blocking delta for anthropic", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text: "whole summary" }] }), { status: 200 });
  const config = { provider: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "k", model: "claude" };
  const deltas = await collect(streamAi({ system: "s", prompt: "p", config }));
  assert.deepEqual(deltas, ["whole summary"]);
});

test("streamOpenAiCompatible retries once on 400 with reasoning_effort stripped", async () => {
  let callCount = 0;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    callCount++;
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (callCount === 1) {
      assert.equal(body.reasoning_effort, "minimal");
      return new Response("bad request", { status: 400 });
    }
    assert.equal("reasoning_effort" in body, false);
    return sseResponse(['data: {"choices":[{"delta":{"content":"retried"}}]}\n\n', "data: [DONE]\n\n"]);
  };
  const deltas = await collect(
    streamOpenAiCompatible({
      baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m",
      system: "s", prompt: "p", timeoutMs: 5000, reasoningEffort: "minimal",
    })
  );
  assert.equal(callCount, 2);
  assert.deepEqual(deltas, ["retried"]);
  assert.equal(bodies[0].reasoning_effort, "minimal");
  assert.equal("reasoning_effort" in bodies[1], false);
});

test("streamOpenAiCompatible does not retry a second time if retry also fails", async () => {
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return new Response("bad request", { status: 400 });
  };
  await assert.rejects(
    collect(
      streamOpenAiCompatible({
        baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m",
        system: "s", prompt: "p", timeoutMs: 5000, reasoningEffort: "minimal",
      })
    )
  );
  assert.equal(callCount, 2);
});
