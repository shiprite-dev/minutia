// ---------------------------------------------------------------------------
// Local WhisperX + pyannote sidecar client (keyless self-host / dev lane).
//
// The sidecar is an optional container the operator runs; this client only
// speaks its HTTP contract: multipart upload in, {text, segments} out. Segment
// times are already in seconds. No provider key; the "credential" is the URL.
// ---------------------------------------------------------------------------

import {
  TranscriptionError,
  mapHttpStatusToCode,
  type TranscriptionResult,
  type TranscriptionSegment,
} from "./shared";

export const LOCAL_STT_DEFAULT_MODEL = "whisperx+pyannote";

// 240s stays under the 300s transcribe-route budget; the old 600s default
// exceeded the request budget, so a long local job could never finish inside
// the request that held it. Longer local work needs a durable async executor.
const LOCAL_DEFAULT_TIMEOUT_MS = 240_000;

interface LocalOptions {
  url: string;
  speakersExpected?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  deadlineAt?: number;
}

export async function transcribeWithLocalSidecar(
  audio: Blob,
  { url, speakersExpected, timeoutMs = LOCAL_DEFAULT_TIMEOUT_MS, signal, deadlineAt }: LocalOptions
): Promise<TranscriptionResult> {
  // Clamp the attempt to the remaining request budget; an exhausted request
  // makes zero provider calls instead of borrowing time it does not have.
  if (deadlineAt != null) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      throw new TranscriptionError("timeout", "Transcription request budget exhausted", {
        provider: "local",
      });
    }
    timeoutMs = Math.min(timeoutMs, remaining);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort);
  const stopTimer = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  };

  const form = new FormData();
  form.append("file", audio, "meeting-audio.webm");
  if (speakersExpected && speakersExpected > 1) form.append("num_speakers", String(speakersExpected));

  try {
    const res = await fetch(url, { method: "POST", body: form, signal: controller.signal });
    if (!res.ok) {
      // Keep the timer armed through the error body: headers alone are not
      // liveness evidence.
      let detail = "";
      try {
        detail = await res.text();
      } catch (error) {
        stopTimer();
        throw new TranscriptionError("timeout", "Local STT sidecar hung on the error body", {
          provider: "local",
          cause: error,
        });
      }
      stopTimer();
      throw new TranscriptionError(
        mapHttpStatusToCode(res.status),
        `Local STT sidecar returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        { status: res.status, provider: "local" }
      );
    }
    const data = (await res.json()) as {
      text?: string;
      segments?: { speaker: string; start: number; end: number; text: string; score?: number }[];
    };
    stopTimer();
    const segments: TranscriptionSegment[] = (data.segments ?? []).map((s) => ({
      speaker: s.speaker,
      start: s.start,
      end: s.end,
      text: s.text,
      confidence: typeof s.score === "number" ? s.score : null,
    }));
    const text = data.text ?? segments.map((s) => s.text).join(" ");
    // An explicit empty text (or empty segment set) from a finished job is
    // confirmed silence. A missing text with no segments is a malformed
    // payload: leave the outcome unset so callers treat it as invalid.
    let outcome: "speech" | "no_speech" | undefined;
    if (data.text != null || data.segments != null) {
      outcome = text.trim() === "" ? "no_speech" : "speech";
    }
    return {
      text,
      model: LOCAL_STT_DEFAULT_MODEL,
      provider: "local",
      durationSeconds: segments.length ? segments[segments.length - 1].end : null,
      segments: segments.length ? segments : undefined,
      diarized: segments.length > 0,
      outcome,
    };
  } catch (error) {
    stopTimer();
    if (error instanceof TranscriptionError) throw error;
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new TranscriptionError(aborted ? "timeout" : "provider_error", "Local STT sidecar request failed", {
      provider: "local",
      cause: error,
    });
  }
}