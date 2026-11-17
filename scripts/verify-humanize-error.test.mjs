import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure error-humanizer so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-errors-"));
const bundled = path.join(tempDir, "errors.mjs");
await esbuild.build({
  entryPoints: ["src/lib/errors.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { humanizeError } = await import(pathToFileURL(bundled).href);

test("maps invalid-credentials to friendly copy", () => {
  assert.equal(
    humanizeError(new Error("Invalid login credentials")),
    "That email or password doesn't match our records."
  );
});

test("maps expired session / JWT to a re-auth prompt", () => {
  const msg = humanizeError(new Error("JWT expired"));
  assert.match(msg, /session expired/i);
  assert.equal(humanizeError({ message: "not authenticated" }), msg);
});

test("maps duplicate-key / unique violation to an already-exists message", () => {
  assert.match(
    humanizeError({ code: "23505", message: 'duplicate key value violates unique constraint' }),
    /already exists/i
  );
});

test("maps rate limiting to a wait-and-retry message", () => {
  assert.match(humanizeError(new Error("Too Many Requests 429")), /too many/i);
  assert.match(humanizeError({ message: "rate limit exceeded" }), /too many/i);
});

test("maps network / fetch failures to a connection message", () => {
  assert.match(humanizeError(new TypeError("Failed to fetch")), /connection/i);
  assert.match(humanizeError(new Error("NetworkError when attempting to fetch resource")), /connection/i);
});

test("passes through a clean, human-readable server message", () => {
  assert.equal(
    humanizeError({ message: "Inviting members requires an upgraded workspace." }),
    "Inviting members requires an upgraded workspace."
  );
});

test("falls back to a generic message for empty/opaque/unknown input", () => {
  const generic = "Something went wrong. Please try again.";
  assert.equal(humanizeError(null), generic);
  assert.equal(humanizeError(undefined), generic);
  assert.equal(humanizeError({}), generic);
  assert.equal(humanizeError(""), generic);
  // Opaque low-level Postgres noise should not be shown raw.
  assert.equal(
    humanizeError(new Error('null value in column "x" violates not-null constraint')),
    generic
  );
});

test("accepts a raw string", () => {
  assert.equal(humanizeError("Invalid login credentials"), "That email or password doesn't match our records.");
});

test("normalizes a top-level string error from a response body", () => {
  assert.equal(
    humanizeError({ error: "Transcription failed.", code: "timeout" }),
    "Transcription took too long. Try again."
  );
  assert.equal(
    humanizeError({ error: "Inviting members requires an upgraded workspace." }),
    "Inviting members requires an upgraded workspace."
  );
});

test("maps transcription codes to plain, non-technical, actionable copy", () => {
  const cases = {
    timeout: "Transcription took too long. Try again.",
    rate_limit: "Transcription is temporarily busy. Try again in a moment.",
    auth_error: "This workspace has not been set up for transcription yet. Ask your administrator.",
    no_api_key: "This workspace has not been set up for transcription yet. Ask your administrator.",
    provider_not_configured:
      "This workspace has not been set up for transcription yet. Ask your administrator.",
    transcription_unconfigured:
      "This workspace has not been set up for transcription yet. Ask your administrator.",
    unsupported_format: "This recording format is not supported. Try uploading the recording again.",
    provider_error: "Transcription failed. Try again.",
    processing_conflict: "This recording is already being transcribed.",
    input_mismatch: "This recording changed. Refresh to see its current status.",
    extraction_failed: "Your transcript is ready, but action items could not be created.",
    download_failed: "The recording could not be downloaded. Try again.",
  };
  for (const [code, copy] of Object.entries(cases)) {
    assert.equal(humanizeError({ error: "Transcription failed.", code }), copy, `body shape for ${code}`);
    assert.equal(humanizeError({ code }), copy, `code only for ${code}`);
  }
});

test("prototype keys are never treated as transcription codes", () => {
  assert.equal(humanizeError({ error: "Transcription failed.", code: "constructor" }), "Transcription failed.");
  assert.equal(humanizeError({ code: "__proto__" }), "Something went wrong. Please try again.");
});

test("transcription code mappings never leak the raw code", () => {
  for (const code of ["timeout", "rate_limit", "auth_error", "unsupported_format", "input_mismatch"]) {
    const copy = humanizeError({ error: "Transcription failed.", code });
    assert.ok(!copy.toLowerCase().includes(code), `${code} must not appear in user copy`);
  }
});
