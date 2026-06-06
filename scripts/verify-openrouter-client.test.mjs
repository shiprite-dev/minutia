import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the TypeScript client so we can exercise it from node:test (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-openrouter-"));
const bundled = path.join(tempDir, "openrouter.mjs");
await esbuild.build({
  entryPoints: ["src/lib/ai/openrouter.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { callOpenRouter, getOpenRouterApiKey } = await import(pathToFileURL(bundled).href);

const okBody = JSON.stringify({
  choices: [{ message: { content: '{"ok":true}' } }],
});

// Build a fake fetch that decides ok/fail per requested model, and records calls.
function fakeFetch(decide) {
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    const outcome = decide(model, calls.length);
    if (outcome === "network") throw new Error("network down");
    if (outcome === "bad") {
      return { ok: false, status: 502, async json() { return {}; } };
    }
    return { ok: true, status: 200, async json() { return JSON.parse(okBody); } };
  };
  return calls;
}

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

test("getOpenRouterApiKey prefers OPENROUTER_API_KEY then AI_API_KEY", () => {
  const prev = { o: process.env.OPENROUTER_API_KEY, a: process.env.AI_API_KEY };
  process.env.OPENROUTER_API_KEY = "primary";
  process.env.AI_API_KEY = "secondary";
  assert.equal(getOpenRouterApiKey(), "primary");
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(getOpenRouterApiKey(), "secondary");
  delete process.env.AI_API_KEY;
  assert.equal(getOpenRouterApiKey(), null);
  process.env.OPENROUTER_API_KEY = prev.o ?? "";
  process.env.AI_API_KEY = prev.a ?? "";
  if (!prev.o) delete process.env.OPENROUTER_API_KEY;
  if (!prev.a) delete process.env.AI_API_KEY;
});

test("callOpenRouter returns data and the model that answered", async () => {
  fakeFetch(() => "ok");
  const result = await callOpenRouter({
    apiKey: "k", system: "s", prompt: "p", models: ["strong"], retries: 0,
  });
  assert.deepEqual(result.data, JSON.parse(okBody));
  assert.equal(result.model, "strong");
});

test("callOpenRouter falls back to the next model when the primary fails", async () => {
  const calls = fakeFetch((model) => (model === "strong" ? "bad" : "ok"));
  const result = await callOpenRouter({
    apiKey: "k", system: "s", prompt: "p", models: ["strong", "cheap"], retries: 0,
  });
  assert.equal(result.model, "cheap");
  assert.deepEqual(calls, ["strong", "cheap"]);
});

test("callOpenRouter retries the same model before giving up", async () => {
  const calls = fakeFetch((model, n) => (n === 1 ? "network" : "ok"));
  const result = await callOpenRouter({
    apiKey: "k", system: "s", prompt: "p", models: ["strong"], retries: 1,
  });
  assert.equal(result.model, "strong");
  assert.equal(calls.length, 2); // failed once, retried, succeeded
});

test("callOpenRouter throws when every model and retry fails", async () => {
  fakeFetch(() => "bad");
  await assert.rejects(
    callOpenRouter({ apiKey: "k", system: "s", prompt: "p", models: ["a", "b"], retries: 1 }),
    /Provider request failed/
  );
});

test("callOpenRouter defaults to getAiModels() when no models passed", async () => {
  const prev = { m: process.env.AI_MODEL, f: process.env.AI_MODEL_FALLBACK };
  process.env.AI_MODEL = "anthropic/claude-sonnet-4-6";
  process.env.AI_MODEL_FALLBACK = "google/gemini-3.1-flash-lite";
  const calls = fakeFetch((model) => (model.includes("claude") ? "bad" : "ok"));
  const result = await callOpenRouter({ apiKey: "k", system: "s", prompt: "p", retries: 0 });
  assert.equal(result.model, "google/gemini-3.1-flash-lite");
  assert.deepEqual(calls, ["anthropic/claude-sonnet-4-6", "google/gemini-3.1-flash-lite"]);
  if (prev.m) process.env.AI_MODEL = prev.m; else delete process.env.AI_MODEL;
  if (prev.f) process.env.AI_MODEL_FALLBACK = prev.f; else delete process.env.AI_MODEL_FALLBACK;
});
