import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// A saved recording whose transcription never started must not sit on
// "Preparing transcription" forever: the meeting row decides whether the
// viewer needs an administrator or can retry.
const root = process.cwd();
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "minutia-transcription-stall-"),
);
const bundled = path.join(tempDir, "stall.mjs");
await esbuild.build({
  entryPoints: ["src/lib/transcription/stall.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const {
  stalledTranscriptionState,
  PENDING_STALE_MS,
  ADMIN_TRANSCRIPTION_CODES,
} = await import(pathToFileURL(bundled).href);

const NOW = Date.parse("2026-11-17T10:00:00Z");
const longAgo = new Date(NOW - PENDING_STALE_MS - 1000).toISOString();
const justNow = new Date(NOW - 5000).toISOString();

function meeting(overrides = {}) {
  return {
    audio_file_path: "m/rec.m4a",
    transcription_status: "pending",
    transcription_error_code: null,
    completed_at: longAgo,
    created_at: longAgo,
    ...overrides,
  };
}

test("the staleness window is short, a few minutes at most", () => {
  assert.ok(PENDING_STALE_MS > 0 && PENDING_STALE_MS <= 5 * 60 * 1000);
});

test("every configuration failure code asks for an administrator", () => {
  for (const code of [
    "auth_error",
    "no_api_key",
    "provider_not_configured",
    "transcription_unconfigured",
  ]) {
    assert.ok(ADMIN_TRANSCRIPTION_CODES.has(code), code);
    assert.equal(
      stalledTranscriptionState(
        meeting({ transcription_error_code: code, completed_at: justNow }),
        NOW,
      ),
      "needs_admin",
      code,
    );
  }
});

test("a failed run with a configuration code asks for an administrator", () => {
  assert.equal(
    stalledTranscriptionState(
      meeting({
        transcription_status: "failed",
        transcription_error_code: "no_api_key",
      }),
      NOW,
    ),
    "needs_admin",
  );
});

test("a pending recording past the window offers a retry", () => {
  assert.equal(stalledTranscriptionState(meeting(), NOW), "transcribing_stale");
});

test("a pending recording past the window with a non-configuration failure offers a retry", () => {
  assert.equal(
    stalledTranscriptionState(
      meeting({ transcription_error_code: "provider_error" }),
      NOW,
    ),
    "transcribing_stale",
  );
});

test("a pending recording inside the window keeps preparing", () => {
  assert.equal(
    stalledTranscriptionState(meeting({ completed_at: justNow }), NOW),
    null,
  );
});

test("the window falls back to the creation time when the meeting never completed", () => {
  assert.equal(
    stalledTranscriptionState(
      meeting({ completed_at: null, created_at: longAgo }),
      NOW,
    ),
    "transcribing_stale",
  );
  assert.equal(
    stalledTranscriptionState(
      meeting({ completed_at: null, created_at: justNow }),
      NOW,
    ),
    null,
  );
});

test("without a saved recording nothing is stalled", () => {
  assert.equal(
    stalledTranscriptionState(meeting({ audio_file_path: null }), NOW),
    null,
  );
  assert.equal(
    stalledTranscriptionState(
      meeting({
        audio_file_path: null,
        transcription_error_code: "no_api_key",
      }),
      NOW,
    ),
    null,
  );
});

test("an active, finished, or plainly failed run is left to its own state", () => {
  assert.equal(
    stalledTranscriptionState(
      meeting({ transcription_status: "processing" }),
      NOW,
    ),
    null,
  );
  assert.equal(
    stalledTranscriptionState(
      meeting({ transcription_status: "completed" }),
      NOW,
    ),
    null,
  );
  assert.equal(
    stalledTranscriptionState(
      meeting({
        transcription_status: "failed",
        transcription_error_code: "timeout",
      }),
      NOW,
    ),
    null,
  );
  assert.equal(
    stalledTranscriptionState(meeting({ transcription_status: null }), NOW),
    null,
  );
});
