// ---------------------------------------------------------------------------
// OpenRouter speech-to-text client (fallback provider).
//
// OpenRouter's STT endpoint is JSON (not OpenAI-style multipart): the audio is
// base64-encoded inside `input_audio`, and the duration comes back at
// `usage.seconds`. See https://openrouter.ai/docs/guides/overview/multimodal/stt
// The model and endpoint are env-overridable.
// ---------------------------------------------------------------------------

import { sendTranscription, TranscriptionError, type TranscriptionResult } from "./shared";

export const OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
export const OPENROUTER_STT_DEFAULT_MODEL = "openai/whisper-1";

// supabase-swift stores the macOS companion's AAC-in-MP4 upload under a mime
// derived from the ".m4a" extension, not the explicit FileOptions content
// type, so the same recording can arrive as audio/mp4, audio/x-m4a, or
// audio/m4a (see supabase/migrations/20260704120000_meeting_audio_m4a_mime.sql).
// All must map to "m4a" or the provider 415s a real companion upload.
const M4A_MIME_TYPES = new Set(["audio/mp4", "audio/x-m4a", "audio/m4a"]);

/** OpenRouter's `input_audio.format` from a MIME type (codecs suffix ignored). */
function audioFormatFromMime(mime: string): string {
  const base = mime.split(";")[0].trim();
  if (M4A_MIME_TYPES.has(base)) return "m4a";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/mpeg") return "mp3";
  if (base === "audio/wav") return "wav";
  if (base === "audio/aac") return "aac";
  if (base === "audio/flac") return "flac";
  return "webm";
}

export interface OpenRouterTranscribeOptions {
  apiKey: string;
  model?: string;
  url?: string;
  mimeType?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  deadlineAt?: number;
  /** Overrides the default attribution origin (defaults to SITE_URL). */
  referer?: string;
  /** Request segment timestamps (verbose_json); retried once as plain json when the model rejects it. */
  timestamps?: boolean;
}

export async function transcribeWithOpenRouter(
  audio: Blob,
  {
    apiKey,
    model = process.env.OPENROUTER_STT_MODEL?.trim() || OPENROUTER_STT_DEFAULT_MODEL,
    url = process.env.OPENROUTER_STT_URL?.trim() || OPENROUTER_STT_URL,
    mimeType = "audio/webm",
    timeoutMs,
    signal,
    deadlineAt,
    referer = process.env.SITE_URL ?? "https://example.com",
    timestamps = false,
  }: OpenRouterTranscribeOptions
): Promise<TranscriptionResult> {
  const base64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
  const send = (withTimestamps: boolean) =>
    sendTranscription({
      url,
      apiKey,
      body: JSON.stringify({
        model,
        input_audio: { data: base64, format: audioFormatFromMime(mimeType) },
        ...(withTimestamps ? { response_format: "verbose_json", timestamp_granularities: ["word", "segment"] } : {}),
      }),
      model,
      provider: "openrouter",
      headers: {
        "Content-Type": "application/json",
        "HTTP-Referer": referer,
        "X-Title": "Minutia",
      },
      getDuration: (json) => {
        const usage = json.usage as { seconds?: unknown } | undefined;
        return typeof usage?.seconds === "number" ? usage.seconds : null;
      },
      timeoutMs,
      signal,
      deadlineAt,
    });

  if (!timestamps) return send(false);
  try {
    return await send(true);
  } catch (error) {
    if (error instanceof TranscriptionError && error.code === "unsupported_format") return send(false);
    throw error;
  }
}
