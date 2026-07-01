import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-proxy-trust-"));
const bundled = path.join(tempDir, "trusted-proxy.mjs");

await esbuild.build({
  entryPoints: ["src/lib/trusted-proxy.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});

const { getClientIp } = await import(pathToFileURL(bundled).href);

const originalTrustedProxy = process.env.TRUSTED_PROXY;

test.afterEach(() => {
  if (originalTrustedProxy === undefined) delete process.env.TRUSTED_PROXY;
  else process.env.TRUSTED_PROXY = originalTrustedProxy;
});

function makeHeaders(map) {
  return { get: (k) => map[k.toLowerCase()] ?? null };
}

// --- Default (no TRUSTED_PROXY) ---

test("default: extracts first IP from x-forwarded-for", () => {
  delete process.env.TRUSTED_PROXY;
  const ip = getClientIp(makeHeaders({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }));
  assert.equal(ip, "1.2.3.4");
});

test("default: falls back to x-real-ip when x-forwarded-for absent", () => {
  delete process.env.TRUSTED_PROXY;
  const ip = getClientIp(makeHeaders({ "x-real-ip": "5.6.7.8" }));
  assert.equal(ip, "5.6.7.8");
});

test("default: returns unknown when no IP headers", () => {
  delete process.env.TRUSTED_PROXY;
  const ip = getClientIp(makeHeaders({}));
  assert.equal(ip, "unknown");
});

test("default: ignores CF-Connecting-IP when proxy not trusted", () => {
  delete process.env.TRUSTED_PROXY;
  const ip = getClientIp(makeHeaders({
    "cf-connecting-ip": "9.10.11.12",
    "x-forwarded-for": "1.2.3.4",
  }));
  assert.equal(ip, "1.2.3.4");
});

// --- Cloudflare trusted proxy ---

test("cloudflare: prefers CF-Connecting-IP over x-forwarded-for", () => {
  process.env.TRUSTED_PROXY = "cloudflare";
  const ip = getClientIp(makeHeaders({
    "cf-connecting-ip": "9.10.11.12",
    "x-forwarded-for": "1.2.3.4, 10.0.0.1",
    "x-real-ip": "5.6.7.8",
  }));
  assert.equal(ip, "9.10.11.12");
});

test("cloudflare: falls back to x-forwarded-for when CF-Connecting-IP absent", () => {
  process.env.TRUSTED_PROXY = "cloudflare";
  const ip = getClientIp(makeHeaders({
    "x-forwarded-for": "1.2.3.4",
    "x-real-ip": "5.6.7.8",
  }));
  assert.equal(ip, "1.2.3.4");
});

test("cloudflare: falls back to x-real-ip when both CF and x-forwarded-for absent", () => {
  process.env.TRUSTED_PROXY = "cloudflare";
  const ip = getClientIp(makeHeaders({ "x-real-ip": "5.6.7.8" }));
  assert.equal(ip, "5.6.7.8");
});

test("cloudflare: returns unknown when no IP headers at all", () => {
  process.env.TRUSTED_PROXY = "cloudflare";
  const ip = getClientIp(makeHeaders({}));
  assert.equal(ip, "unknown");
});

// --- Case and whitespace tolerance ---

test("trims whitespace from extracted IP", () => {
  delete process.env.TRUSTED_PROXY;
  const ip = getClientIp(makeHeaders({ "x-forwarded-for": "  1.2.3.4 , 10.0.0.1" }));
  assert.equal(ip, "1.2.3.4");
});

test("cloudflare: trims whitespace from CF-Connecting-IP", () => {
  process.env.TRUSTED_PROXY = "cloudflare";
  const ip = getClientIp(makeHeaders({ "cf-connecting-ip": "  9.10.11.12 " }));
  assert.equal(ip, "9.10.11.12");
});
