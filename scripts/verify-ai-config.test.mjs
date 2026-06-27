import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the TS config module (with no-op stubs for Supabase deps) so we can
// exercise resolveAiConfig in pure Node without a database connection.
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-ai-config-"));
const bundled = path.join(tempDir, "ai-config.mjs");

await esbuild.build({
  entryPoints: ["src/lib/ai/config.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  // Resolve the Next.js @/ path alias so esbuild can bundle instance-config
  // and its transitive deps (Supabase, crypto). Those deps throw only at call
  // time, so the pure resolveAiConfig tests run without a live DB.
  alias: { "@": path.join(root, "src") },
});

const { resolveAiConfig } = await import(pathToFileURL(bundled).href);

// Save and restore any env vars we touch.
const WATCHED = [
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
];
const saved = {};
for (const k of WATCHED) saved[k] = process.env[k];

test.afterEach(() => {
  for (const k of WATCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// --- helpers ---
function emptyMap() {
  return { ai_provider: null, ai_base_url: null, ai_api_key: null, ai_model: null };
}
function emptyEnv() {
  // Return a clean env-like object with none of the watched vars set.
  const e = { ...process.env };
  for (const k of WATCHED) delete e[k];
  return e;
}

// 1. map wins over env for all fields.
test("map values override conflicting env values", () => {
  const map = {
    ai_provider: "anthropic",
    ai_api_key: "map-key",
    ai_model: "map-model",
    ai_base_url: "https://map-base.example.com",
  };
  const env = {
    ...emptyEnv(),
    AI_PROVIDER: "openai-compatible",
    AI_API_KEY: "env-key",
    AI_MODEL: "env-model",
    AI_BASE_URL: "https://env-base.example.com",
  };
  const cfg = resolveAiConfig(map, env);
  // provider from map
  assert.equal(cfg?.provider, "anthropic");
  // apiKey from map
  assert.equal(cfg?.apiKey, "map-key");
  // model from map
  assert.equal(cfg?.model, "map-model");
  // baseUrl: anthropic always https://api.anthropic.com regardless of map/env
  assert.equal(cfg?.baseUrl, "https://api.anthropic.com");
});

// 2. env-only: only AI_API_KEY set -> openai-compatible, default baseUrl, default model.
test("env-only with AI_API_KEY gives openai-compatible defaults", () => {
  const env = { ...emptyEnv(), AI_API_KEY: "env-key-only" };
  const cfg = resolveAiConfig(emptyMap(), env);
  assert.ok(cfg, "should return config");
  assert.equal(cfg.provider, "openai-compatible");
  assert.equal(cfg.apiKey, "env-key-only");
  assert.equal(cfg.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(cfg.model, "google/gemini-3.1-flash-lite");
});

// 3. anthropic provider always forces https://api.anthropic.com even when map.ai_base_url is set.
test("anthropic provider ignores stored/env base url", () => {
  const map = {
    ...emptyMap(),
    ai_provider: "anthropic",
    ai_api_key: "sk-ant",
    ai_base_url: "https://should-be-ignored.example.com",
  };
  const cfg = resolveAiConfig(map, emptyEnv());
  assert.equal(cfg?.baseUrl, "https://api.anthropic.com");
});

// 4. returns null when no api key anywhere.
test("returns null when no api key is present", () => {
  const cfg = resolveAiConfig(emptyMap(), emptyEnv());
  assert.equal(cfg, null);
});

// 5. default model applied when none provided in map or env.
test("falls back to default model when none specified", () => {
  const map = { ...emptyMap(), ai_api_key: "k" };
  const cfg = resolveAiConfig(map, emptyEnv());
  assert.equal(cfg?.model, "google/gemini-3.1-flash-lite");
});

// 6. AI_BASE_URL env fallback honored for openai-compatible when map has none.
test("AI_BASE_URL env is used for openai-compatible when map has no base_url", () => {
  const env = { ...emptyEnv(), AI_API_KEY: "k", AI_BASE_URL: "https://my-proxy.example.com/v1" };
  const cfg = resolveAiConfig(emptyMap(), env);
  assert.equal(cfg?.baseUrl, "https://my-proxy.example.com/v1");
});

// 7. trailing slash trimmed.
test("trailing slash is trimmed from resolved baseUrl", () => {
  const env = { ...emptyEnv(), AI_API_KEY: "k", AI_BASE_URL: "https://x/v1/" };
  const cfg = resolveAiConfig(emptyMap(), env);
  assert.equal(cfg?.baseUrl, "https://x/v1");
});

// 8. invalid provider string returns null.
test("invalid provider string returns null", () => {
  const map = { ...emptyMap(), ai_provider: "invalid-provider", ai_api_key: "k" };
  const cfg = resolveAiConfig(map, emptyEnv());
  assert.equal(cfg, null);
});

// 9. OPENROUTER_API_KEY is honored as a fallback key and triggers openai-compatible default.
test("OPENROUTER_API_KEY triggers openai-compatible default and is used as apiKey", () => {
  const env = { ...emptyEnv(), OPENROUTER_API_KEY: "or-key" };
  const cfg = resolveAiConfig(emptyMap(), env);
  assert.ok(cfg, "should return config");
  assert.equal(cfg.provider, "openai-compatible");
  assert.equal(cfg.apiKey, "or-key");
});

// 10. OPENROUTER_MODEL env fallback for model.
test("OPENROUTER_MODEL env is used as model fallback", () => {
  const env = { ...emptyEnv(), AI_API_KEY: "k", OPENROUTER_MODEL: "or-model" };
  const cfg = resolveAiConfig(emptyMap(), env);
  assert.equal(cfg?.model, "or-model");
});

// 11. null/empty string map values count as absent (env wins).
test("empty string map values are treated as absent and env wins", () => {
  const map = { ai_provider: "", ai_api_key: "", ai_model: "", ai_base_url: "" };
  const env = {
    ...emptyEnv(),
    AI_PROVIDER: "openai-compatible",
    AI_API_KEY: "env-k",
    AI_MODEL: "env-model",
    AI_BASE_URL: "https://env-base.example.com/v1",
  };
  const cfg = resolveAiConfig(map, env);
  assert.ok(cfg, "should return config");
  assert.equal(cfg.provider, "openai-compatible");
  assert.equal(cfg.apiKey, "env-k");
  assert.equal(cfg.model, "env-model");
  assert.equal(cfg.baseUrl, "https://env-base.example.com/v1");
});
