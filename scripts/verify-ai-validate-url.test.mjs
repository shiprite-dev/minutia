import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-ai-validate-url-"));
const bundled = path.join(tempDir, "validate-url.mjs");

await esbuild.build({
  entryPoints: ["src/lib/ai/validate-url.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});

const { validateAiBaseUrl } = await import(pathToFileURL(bundled).href);

// --- happy path ---

test("https public API is ok", () => {
  const result = validateAiBaseUrl("https://api.openai.com/v1");
  assert.deepEqual(result, { ok: true, url: "https://api.openai.com/v1" });
});

test("https with trailing slash is trimmed", () => {
  const result = validateAiBaseUrl("https://openrouter.ai/api/v1/");
  assert.deepEqual(result, { ok: true, url: "https://openrouter.ai/api/v1" });
});

test("http localhost with port is ok", () => {
  const result = validateAiBaseUrl("http://localhost:11434/v1");
  assert.deepEqual(result, { ok: true, url: "http://localhost:11434/v1" });
});

test("http 127.0.0.1 loopback is ok", () => {
  const result = validateAiBaseUrl("http://127.0.0.1:11434");
  assert.deepEqual(result, { ok: true, url: "http://127.0.0.1:11434" });
});

test("http host.docker.internal is ok", () => {
  const result = validateAiBaseUrl("http://host.docker.internal:11434");
  assert.deepEqual(result, { ok: true, url: "http://host.docker.internal:11434" });
});

test("http .local hostname is ok", () => {
  const result = validateAiBaseUrl("http://ollama.local");
  assert.deepEqual(result, { ok: true, url: "http://ollama.local" });
});

test("http 10.x private range is ok", () => {
  const result = validateAiBaseUrl("http://10.0.0.3");
  assert.deepEqual(result, { ok: true, url: "http://10.0.0.3" });
});

test("http 192.168.x private range is ok", () => {
  const result = validateAiBaseUrl("http://192.168.1.5:1234");
  assert.deepEqual(result, { ok: true, url: "http://192.168.1.5:1234" });
});

test("http 172.16.x private range is ok", () => {
  const result = validateAiBaseUrl("http://172.16.5.5");
  assert.deepEqual(result, { ok: true, url: "http://172.16.5.5" });
});

// --- error cases ---

test("http public hostname is insecure-http", () => {
  const result = validateAiBaseUrl("http://example.com");
  assert.deepEqual(result, { ok: false, reason: "insecure-http" });
});

test("https cloud metadata IP is blocked-host", () => {
  const result = validateAiBaseUrl("https://169.254.169.254");
  assert.deepEqual(result, { ok: false, reason: "blocked-host" });
});

test("http cloud metadata IP is blocked-host", () => {
  const result = validateAiBaseUrl("http://169.254.169.254");
  assert.deepEqual(result, { ok: false, reason: "blocked-host" });
});

test("ftp scheme is invalid-scheme", () => {
  const result = validateAiBaseUrl("ftp://x");
  assert.deepEqual(result, { ok: false, reason: "invalid-scheme" });
});

test("non-URL string is invalid-url", () => {
  const result = validateAiBaseUrl("not a url");
  assert.deepEqual(result, { ok: false, reason: "invalid-url" });
});

// --- additional edge cases ---

test("http ::1 IPv6 loopback is ok", () => {
  const result = validateAiBaseUrl("http://[::1]:8080");
  assert.deepEqual(result, { ok: true, url: "http://[::1]:8080" });
});

test("link-local 169.254.x.x other than .254 is also blocked", () => {
  const result = validateAiBaseUrl("https://169.254.0.1");
  assert.deepEqual(result, { ok: false, reason: "blocked-host" });
});

test("172.15.x is NOT in private range (boundary check)", () => {
  // 172.15.x is just outside the 172.16-172.31 range
  const result = validateAiBaseUrl("http://172.15.0.1");
  assert.deepEqual(result, { ok: false, reason: "insecure-http" });
});

test("172.32.x is NOT in private range (boundary check)", () => {
  // 172.32.x is just outside the 172.16-172.31 range
  const result = validateAiBaseUrl("http://172.32.0.1");
  assert.deepEqual(result, { ok: false, reason: "insecure-http" });
});

test("trailing slash on root path is stripped", () => {
  const result = validateAiBaseUrl("http://localhost/");
  assert.deepEqual(result, { ok: true, url: "http://localhost" });
});

test("port and query string are preserved", () => {
  const result = validateAiBaseUrl("https://api.example.com:8443/v2?foo=bar");
  assert.deepEqual(result, { ok: true, url: "https://api.example.com:8443/v2?foo=bar" });
});
