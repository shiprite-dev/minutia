// Failures only an administrator can fix: retrying cannot help until the
// instance has a transcription provider and a valid key.
export const ADMIN_TRANSCRIPTION_CODES = new Set([
  "auth_error",
  "no_api_key",
  "provider_not_configured",
  "transcription_unconfigured",
]);

// A saved recording normally starts transcribing within seconds of upload.
export const PENDING_STALE_MS = 2 * 60 * 1000;

interface StallInput {
  audio_file_path: string | null;
  transcription_status: string | null;
  transcription_error_code?: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
}

/** The state for a saved recording whose transcription never got going, or
 * null when the meeting is in any other state. */
export function stalledTranscriptionState(
  m: StallInput,
  now: number
): "needs_admin" | "transcribing_stale" | null {
  if (!m.audio_file_path) return null;
  const status = m.transcription_status;
  if (status !== "pending" && status !== "failed") return null;
  if (m.transcription_error_code && ADMIN_TRANSCRIPTION_CODES.has(m.transcription_error_code)) {
    return "needs_admin";
  }
  if (status !== "pending") return null;
  const savedAt = new Date(m.completed_at ?? m.created_at).getTime();
  return now - savedAt > PENDING_STALE_MS ? "transcribing_stale" : null;
}
