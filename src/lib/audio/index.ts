// ---------------------------------------------------------------------------
// Browser-based meeting audio capture utilities.
//
// Pure, dependency-injected helpers (no React, no global state) so they can be
// unit tested in node and reused by the recorder hook, the live capture UI, and
// the end-meeting upload path.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

/** Private Supabase Storage bucket that holds raw meeting recordings. */
export const MEETING_AUDIO_BUCKET = "meeting-audio";

/**
 * MediaRecorder container/codec preferences, best first. Opus-in-WebM is the
 * smallest broadly supported option; Safari only exposes mp4/aac.
 */
export const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

type MimeSupported = (type: string) => boolean;

function defaultMimeSupported(type: string): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported(type)
  );
}

/** First container the current browser can actually record, or null if none. */
export function pickAudioMimeType(
  isSupported: MimeSupported = defaultMimeSupported
): string | null {
  return AUDIO_MIME_CANDIDATES.find((type) => isSupported(type)) ?? null;
}

type RecordingScope = {
  MediaRecorder?: unknown;
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
};

/** True when this environment can capture microphone audio at all. */
export function isRecordingSupported(
  scope: RecordingScope = globalThis as RecordingScope
): boolean {
  return (
    typeof scope.MediaRecorder !== "undefined" &&
    typeof scope.navigator?.mediaDevices?.getUserMedia === "function"
  );
}

/** File extension for a recorded MIME type (ignores the codecs= suffix). */
export function audioExtensionForMime(mime: string): string {
  const base = mime.split(";")[0].trim();
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/mpeg") return "mp3";
  if (base === "audio/wav") return "wav";
  return "webm";
}

/**
 * Storage content type for a recording: the bare MIME essence with any codec
 * parameter stripped. MediaRecorder reports e.g. "audio/webm;codecs=opus", but
 * the bucket's allowed_mime_types list bare containers, so Supabase Storage
 * rejects the parameterized form with a 415. Always upload with the essence.
 */
export function audioContentType(mime: string): string {
  return mime.split(";")[0].trim();
}

/**
 * Object key within MEETING_AUDIO_BUCKET. The meeting id is the first path
 * segment so storage RLS can authorize by joining meetings -> meeting_series.
 */
export function audioStoragePath(meetingId: string, mime = "audio/webm"): string {
  return `${meetingId}/recording.${audioExtensionForMime(mime)}`;
}

/** Human-readable elapsed time: mm:ss, escalating to hh:mm:ss past an hour. */
export function formatRecordingDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Turn a getUserMedia failure into a specific, actionable message. The DOMException
 * `name` distinguishes a real permission denial from a device that is missing or held
 * by another app, so we never tell a user "access denied" when they already granted it.
 */
export function micErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was denied. Allow it for this site in your browser, then press Record again.";
    case "NotReadableError":
    case "AbortError":
      return "Your microphone is in use by another app. Close it (Zoom, the Minutia companion, another tab), then press Record again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Connect one, then press Record again.";
    default:
      return "Could not start the microphone. Check your browser's microphone settings and try again.";
  }
}

export interface UploadMeetingAudioParams {
  meetingId: string;
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}

/**
 * Upload a finished recording to private storage and stamp the meeting row.
 * Storage write happens first; the row is only marked 'pending' once the audio
 * is durably stored, so a failed upload never queues a non-existent file for
 * transcription. Throws on either failure (the caller still completes the
 * meeting; the recording survives in IndexedDB for retry).
 */
export async function uploadMeetingAudio(
  supabase: SupabaseClient,
  { meetingId, blob, durationSeconds, mimeType }: UploadMeetingAudioParams
): Promise<{ path: string }> {
  const path = audioStoragePath(meetingId, mimeType);

  const { error: uploadError } = await supabase.storage
    .from(MEETING_AUDIO_BUCKET)
    .upload(path, blob, { contentType: audioContentType(mimeType), upsert: true });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from("meetings")
    .update({
      audio_file_path: path,
      audio_duration_seconds: Math.round(durationSeconds),
      audio_file_size_bytes: blob.size,
      transcription_status: "pending",
    })
    .eq("id", meetingId);
  if (updateError) throw updateError;

  return { path };
}
