import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure companion-link helpers for node:test (repo verifier pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-companion-links-"));
const bundled = path.join(tempDir, "companion-links.mjs");
await esbuild.build({
  entryPoints: ["src/lib/companion-links.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { buildCompanionAuthCallbackUrl, buildCompanionRecordUrl, isMacPlatform } =
  await import(pathToFileURL(bundled).href);

const LOWER = "0f9c2c9a-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

test("buildCompanionAuthCallbackUrl encodes the token hash into the scheme", () => {
  assert.equal(
    buildCompanionAuthCallbackUrl("abc123"),
    "minutia://auth-callback?token_hash=abc123"
  );
  assert.equal(
    buildCompanionAuthCallbackUrl("a b+c"),
    "minutia://auth-callback?token_hash=a%20b%2Bc"
  );
});

test("buildCompanionAuthCallbackUrl rejects an empty token hash", () => {
  assert.throws(() => buildCompanionAuthCallbackUrl(""));
  assert.throws(() => buildCompanionAuthCallbackUrl("   "));
});

test("buildCompanionAuthCallbackUrl appends the state nonce when present", () => {
  assert.equal(
    buildCompanionAuthCallbackUrl("abc123", "nonce-1"),
    "minutia://auth-callback?token_hash=abc123&state=nonce-1"
  );
  assert.equal(
    buildCompanionAuthCallbackUrl("abc123", "a b+c/d"),
    "minutia://auth-callback?token_hash=abc123&state=a%20b%2Bc%2Fd"
  );
  assert.equal(
    buildCompanionAuthCallbackUrl("abc123", "a&b=c#d"),
    "minutia://auth-callback?token_hash=abc123&state=a%26b%3Dc%23d"
  );
});

test("buildCompanionAuthCallbackUrl omits state when absent or empty", () => {
  assert.equal(
    buildCompanionAuthCallbackUrl("abc123"),
    "minutia://auth-callback?token_hash=abc123"
  );
  assert.equal(
    buildCompanionAuthCallbackUrl("abc123", null),
    "minutia://auth-callback?token_hash=abc123"
  );
  assert.equal(
    buildCompanionAuthCallbackUrl("abc123", ""),
    "minutia://auth-callback?token_hash=abc123"
  );
});

test("buildCompanionRecordUrl builds the record scheme with the meeting id", () => {
  assert.equal(
    buildCompanionRecordUrl(LOWER),
    `minutia://record?meeting_id=${LOWER}`
  );
});

test("buildCompanionRecordUrl lowercases an uppercase meeting id", () => {
  assert.equal(
    buildCompanionRecordUrl(LOWER.toUpperCase()),
    `minutia://record?meeting_id=${LOWER}`
  );
});

test("buildCompanionRecordUrl rejects non-uuid meeting ids", () => {
  assert.throws(() => buildCompanionRecordUrl("not-a-uuid"));
  assert.throws(() => buildCompanionRecordUrl(""));
  assert.throws(() => buildCompanionRecordUrl(`${LOWER} OR 1=1`));
  assert.throws(() => buildCompanionRecordUrl(`${LOWER}/extra`));
});

test("isMacPlatform prefers userAgentData.platform when present", () => {
  assert.equal(isMacPlatform({ platform: "macOS" }, "irrelevant"), true);
  assert.equal(isMacPlatform({ platform: "Windows" }, "Mac irrelevant"), false);
});

test("isMacPlatform falls back to the userAgent string", () => {
  assert.equal(
    isMacPlatform(undefined, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
    true
  );
  assert.equal(isMacPlatform(undefined, "Mozilla/5.0 (Windows NT 10.0)"), false);
  assert.equal(isMacPlatform(undefined, undefined), false);
  assert.equal(isMacPlatform({}, "Macintosh"), true);
});
