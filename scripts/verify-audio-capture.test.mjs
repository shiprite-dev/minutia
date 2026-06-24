import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure audio logic so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-audio-"));
const bundled = path.join(tempDir, "audio.mjs");
await esbuild.build({
  entryPoints: ["src/lib/audio/index.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const {
  AUDIO_MIME_CANDIDATES,
  MEETING_AUDIO_BUCKET,
  pickAudioMimeType,
  isRecordingSupported,
  audioExtensionForMime,
  audioContentType,
  audioStoragePath,
  formatRecordingDuration,
  uploadMeetingAudio,
} = await import(pathToFileURL(bundled).href);

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

const migrations = fs
  .readdirSync(path.join(root, "supabase", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => read(path.join("supabase", "migrations", f)))
  .join("\n");

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("MEETING_AUDIO_BUCKET is the private meeting-audio bucket", () => {
  assert.equal(MEETING_AUDIO_BUCKET, "meeting-audio");
});

test("pickAudioMimeType returns the first supported candidate", () => {
  // Only the second candidate is supported -> it wins.
  const supported = new Set([AUDIO_MIME_CANDIDATES[1]]);
  assert.equal(
    pickAudioMimeType((t) => supported.has(t)),
    AUDIO_MIME_CANDIDATES[1]
  );
});

test("pickAudioMimeType prefers opus webm when everything is supported", () => {
  assert.equal(pickAudioMimeType(() => true), "audio/webm;codecs=opus");
});

test("pickAudioMimeType returns null when no candidate is supported", () => {
  assert.equal(pickAudioMimeType(() => false), null);
});

test("isRecordingSupported requires MediaRecorder and getUserMedia", () => {
  const ok = {
    MediaRecorder: function () {},
    navigator: { mediaDevices: { getUserMedia: () => {} } },
  };
  assert.equal(isRecordingSupported(ok), true);
  assert.equal(isRecordingSupported({}), false);
  assert.equal(
    isRecordingSupported({ MediaRecorder: function () {}, navigator: {} }),
    false
  );
  assert.equal(
    isRecordingSupported({ navigator: { mediaDevices: { getUserMedia: () => {} } } }),
    false
  );
});

test("audioExtensionForMime maps container to a sensible file extension", () => {
  assert.equal(audioExtensionForMime("audio/webm;codecs=opus"), "webm");
  assert.equal(audioExtensionForMime("audio/webm"), "webm");
  assert.equal(audioExtensionForMime("audio/mp4"), "m4a");
  assert.equal(audioExtensionForMime("audio/ogg;codecs=opus"), "ogg");
});

test("audioContentType strips codec params so the bucket allow-list accepts it", () => {
  // Supabase Storage rejects "audio/webm;codecs=opus" (415) against an
  // allowed_mime_types list of bare containers; upload with the essence.
  assert.equal(audioContentType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(audioContentType("audio/ogg;codecs=opus"), "audio/ogg");
  assert.equal(audioContentType("audio/webm"), "audio/webm");
  assert.equal(audioContentType("audio/mp4"), "audio/mp4");
});

test("audioStoragePath keys objects under the meeting id folder", () => {
  assert.equal(
    audioStoragePath("abc-123", "audio/webm;codecs=opus"),
    "abc-123/recording.webm"
  );
  assert.equal(audioStoragePath("abc-123", "audio/mp4"), "abc-123/recording.m4a");
});

test("formatRecordingDuration renders mm:ss and hh:mm:ss", () => {
  assert.equal(formatRecordingDuration(0), "00:00");
  assert.equal(formatRecordingDuration(9), "00:09");
  assert.equal(formatRecordingDuration(75), "01:15");
  assert.equal(formatRecordingDuration(3661), "01:01:01");
});

test("formatRecordingDuration clamps negatives and floors fractional seconds", () => {
  assert.equal(formatRecordingDuration(-5), "00:00");
  assert.equal(formatRecordingDuration(8.9), "00:08");
});

// ---------------------------------------------------------------------------
// uploadMeetingAudio (dependency-injected supabase client)
// ---------------------------------------------------------------------------

function makeFakeSupabase(opts = {}) {
  const calls = {};
  return {
    calls,
    storage: {
      from(bucket) {
        calls.bucket = bucket;
        return {
          async upload(p, blob, options) {
            calls.upload = { path: p, blob, options };
            return { error: opts.uploadError ?? null };
          },
        };
      },
    },
    from(table) {
      calls.table = table;
      return {
        update(values) {
          calls.update = values;
          return {
            async eq(col, val) {
              calls.eq = { col, val };
              return { error: opts.updateError ?? null };
            },
          };
        },
      };
    },
  };
}

test("uploadMeetingAudio uploads to the bucket and stamps the meeting row", async () => {
  const supabase = makeFakeSupabase();
  const blob = { size: 524288, type: "audio/webm" };
  const result = await uploadMeetingAudio(supabase, {
    meetingId: "meeting-1",
    blob,
    durationSeconds: 65.7,
    mimeType: "audio/webm;codecs=opus",
  });

  assert.equal(supabase.calls.bucket, "meeting-audio");
  assert.equal(supabase.calls.upload.path, "meeting-1/recording.webm");
  // Bare essence, not "audio/webm;codecs=opus": the bucket allow-list rejects
  // codec parameters with a 415.
  assert.equal(supabase.calls.upload.options.contentType, "audio/webm");
  assert.equal(supabase.calls.upload.options.upsert, true);
  assert.equal(result.path, "meeting-1/recording.webm");

  assert.equal(supabase.calls.table, "meetings");
  assert.equal(supabase.calls.eq.val, "meeting-1");
  assert.equal(supabase.calls.update.audio_file_path, "meeting-1/recording.webm");
  assert.equal(supabase.calls.update.audio_duration_seconds, 66); // rounded
  assert.equal(supabase.calls.update.audio_file_size_bytes, 524288);
  assert.equal(supabase.calls.update.transcription_status, "pending");
});

test("uploadMeetingAudio throws when the storage upload fails", async () => {
  const supabase = makeFakeSupabase({ uploadError: new Error("storage down") });
  await assert.rejects(
    uploadMeetingAudio(supabase, {
      meetingId: "m",
      blob: { size: 1 },
      durationSeconds: 1,
      mimeType: "audio/webm",
    }),
    /storage down/
  );
  // Must not stamp the row if the upload failed.
  assert.equal(supabase.calls.update, undefined);
});

test("uploadMeetingAudio throws when the row update fails", async () => {
  const supabase = makeFakeSupabase({ updateError: new Error("rls denied") });
  await assert.rejects(
    uploadMeetingAudio(supabase, {
      meetingId: "m",
      blob: { size: 1 },
      durationSeconds: 1,
      mimeType: "audio/webm",
    }),
    /rls denied/
  );
});

// ---------------------------------------------------------------------------
// Migration contract: columns, private bucket, ownership-scoped RLS
// ---------------------------------------------------------------------------

test("migration adds every audio + transcription column to meetings", () => {
  for (const col of [
    "audio_file_path",
    "audio_duration_seconds",
    "audio_file_size_bytes",
    "transcription_status",
    "transcription_model",
    "transcription_provider",
    "transcription_completed_at",
  ]) {
    assert.ok(migrations.includes(col), `migration missing column ${col}`);
  }
});

test("migration constrains transcription_status to the known states", () => {
  for (const state of ["pending", "processing", "completed", "failed"]) {
    assert.ok(
      migrations.includes(`'${state}'`),
      `migration missing transcription_status state ${state}`
    );
  }
});

test("migration creates a private meeting-audio storage bucket", () => {
  assert.ok(migrations.includes("storage.buckets"), "must insert into storage.buckets");
  assert.ok(migrations.includes("'meeting-audio'"), "bucket id must be meeting-audio");
  assert.ok(/'meeting-audio'[\s\S]{0,80}false/.test(migrations), "bucket must be private");
});

test("every recorder mime candidate's bare type is in the bucket allow-list", () => {
  // The upload content type is audioContentType(candidate); if any candidate's
  // essence is missing from allowed_mime_types, Storage rejects it with a 415.
  for (const candidate of AUDIO_MIME_CANDIDATES) {
    const bare = audioContentType(candidate);
    assert.ok(
      migrations.includes(`'${bare}'`),
      `bucket allow-list missing ${bare} for recorder candidate ${candidate}`
    );
  }
});

test("migration scopes storage.objects RLS to the meeting series owner", () => {
  assert.ok(migrations.includes("storage.objects"), "must define storage.objects policies");
  assert.ok(migrations.includes("storage.foldername"), "policy must key off the meeting-id folder");
  assert.ok(migrations.includes("owner_id = auth.uid()"), "policy must scope to the series owner");
  for (const verb of ["FOR SELECT", "FOR INSERT", "FOR UPDATE", "FOR DELETE"]) {
    assert.ok(migrations.includes(verb), `storage policy missing ${verb}`);
  }
});

test("storage policies check ownership via a SECURITY DEFINER helper, not an inline subquery", () => {
  // The storage-api role cannot satisfy public.meetings RLS from inside a
  // storage.objects policy, so an inline EXISTS subquery 403s every owner
  // upload. The ownership check must run through a SECURITY DEFINER function
  // that bypasses the nested RLS and depends only on auth.uid().
  assert.ok(
    migrations.includes("owns_meeting_audio_object"),
    "must define the owns_meeting_audio_object ownership helper"
  );
  assert.ok(
    /CREATE OR REPLACE FUNCTION public\.owns_meeting_audio_object[\s\S]{0,200}SECURITY DEFINER/.test(migrations),
    "ownership helper must be SECURITY DEFINER"
  );
  assert.ok(
    migrations.includes("public.owns_meeting_audio_object(name)"),
    "storage policies must call the ownership helper"
  );
});

// ---------------------------------------------------------------------------
// Type + module + UI wiring contract
// ---------------------------------------------------------------------------

test("Meeting type exposes the audio + transcription fields", () => {
  const types = read("src/lib/types.ts");
  for (const field of [
    "audio_file_path",
    "audio_duration_seconds",
    "audio_file_size_bytes",
    "transcription_status",
    "transcription_model",
    "transcription_provider",
    "transcription_completed_at",
  ]) {
    assert.ok(types.includes(field), `Meeting type missing ${field}`);
  }
  assert.ok(types.includes("TranscriptionStatus"), "types must export TranscriptionStatus");
  assert.ok(types.includes("RecordingState"), "types must export RecordingState");
});

test("recorder hook, indicator, and offline audio buffer exist", () => {
  assert.ok(exists("src/lib/hooks/use-meeting-recorder.ts"), "missing useMeetingRecorder hook");
  assert.ok(exists("src/components/minutia/recording-indicator.tsx"), "missing RecordingIndicator");
  assert.ok(exists("e2e/regression/audio-capture.spec.ts"), "missing audio capture E2E spec");

  const buffer = read("src/lib/offline-buffer.ts");
  for (const fn of ["appendAudioChunk", "getAudioChunks", "clearAudioChunks"]) {
    assert.ok(buffer.includes(fn), `offline buffer missing ${fn} for crash recovery`);
  }
});

test("live meeting view wires the recorder, indicator, and upload-on-end", () => {
  const detail = read(
    "src/app/(app)/series/[id]/meetings/[meetingId]/meeting-detail-content.tsx"
  );
  assert.ok(detail.includes("useMeetingRecorder"), "live view must use the recorder hook");
  assert.ok(detail.includes("RecordingIndicator"), "live view must render the recording indicator");
  assert.ok(detail.includes("uploadMeetingAudio"), "end-meeting must upload the recording");
});

test("seed user has full access so gated capture is reachable in E2E", () => {
  const seed = read("supabase/seed.sql");
  assert.ok(seed.includes("has_full_access"), "seed must set has_full_access for the test user");
});
