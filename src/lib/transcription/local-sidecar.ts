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

interface LocalOptions {
  url: string;
  speakersExpected?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function transcribeWithLocalSidecar(
  audio: Blob,
  { url, speakersExpected, timeoutMs = 600_000, signal }: LocalOptions
): Promise<TranscriptionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  const form = new FormData();
  form.append("file", audio, "meeting-audio.webm");
  if (speakersExpected && speakersExpected > 1) form.append("num_speakers", String(speakersExpected));

  try {
    const res = await fetch(url, { method: "POST", body: form, signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
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
    const segments: TranscriptionSegment[] = (data.segments ?? []).map((s) => ({
      speaker: s.speaker,
      start: s.start,
      end: s.end,
      text: s.text,
      confidence: typeof s.score === "number" ? s.score : null,
    }));
    return {
      text: data.text ?? segments.map((s) => s.text).join(" "),
      model: LOCAL_STT_DEFAULT_MODEL,
      provider: "local",
      durationSeconds: segments.length ? segments[segments.length - 1].end : null,
      segments: segments.length ? segments : undefined,
      diarized: segments.length > 0,
    };
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new TranscriptionError(aborted ? "timeout" : "provider_error", "Local STT sidecar request failed", {
      provider: "local",
      cause: error,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
