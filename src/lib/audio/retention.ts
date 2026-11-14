// ---------------------------------------------------------------------------
// Audio retention policy (pure, no env, no side effects).
//
// Raw recordings are the most sensitive artifact an instance stores, so the
// default is to discard them once a transcript exists. The setting is a
// non-secret instance_config value; unrecognized values are treated as "keep"
// so a typo never destroys data.
// ---------------------------------------------------------------------------

export type AudioRetention = "discard_after_transcript" | "keep_forever";

/** Resolve the stored config value to a retention mode. Discard is the default. */
export function resolveAudioRetention(value: string | null | undefined): AudioRetention {
  if (value == null || value === "" || value === "discard_after_transcript") {
    return "discard_after_transcript";
  }
  // Any other non-empty value keeps the audio: never destroy data on an
  // unrecognized setting.
  return "keep_forever";
}

/** Whether extraction finished or was deliberately skipped. "failed" means
 * suggestions are still outstanding, so the audio must be retained for a
 * retry. An omitted outcome is treated as failed (fail closed). */
export type ExtractionOutcomeForRetention = "completed" | "skipped" | "failed";

/** True only when the policy is discard AND the transcript finished AND
 * extraction completed or was explicitly skipped. */
export function shouldDiscardAudio(
  retention: AudioRetention,
  transcriptionStatus: string | null,
  extraction: ExtractionOutcomeForRetention = "failed"
): boolean {
  return (
    retention === "discard_after_transcript" &&
    transcriptionStatus === "completed" &&
    extraction !== "failed"
  );
}
