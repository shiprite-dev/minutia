// ---------------------------------------------------------------------------
// OpenRouter speech-to-text client (fallback provider).
//
// OpenRouter's STT endpoint is JSON (not OpenAI-style multipart): the audio is
// base64-encoded inside `input_audio`, and the duration comes back at
// `usage.seconds`. See https://openrouter.ai/docs/guides/overview/multimodal/stt
// The model and endpoint are env-overridable.
// ---------------------------------------------------------------------------

import { sendTranscription, type TranscriptionResult } from "./shared";

export const OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
export const OPENROUTER_STT_DEFAULT_MODEL = "openai/whisper-1";

/** OpenRouter's `input_audio.format` from a MIME type (codecs suffix ignored). */
function audioFormatFromMime(mime: string): string {
  const base = mime.split(";")[0].trim();
  if (base === "audio/mp4") return "m4a";
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
  /** Overrides the default attribution origin (defaults to SITE_URL). */
  referer?: string;
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
    referer = process.env.SITE_URL ?? "https://example.com",
  }: OpenRouterTranscribeOptions
): Promise<TranscriptionResult> {
  const base64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
  const body = JSON.stringify({
    model,
    input_audio: { data: base64, format: audioFormatFromMime(mimeType) },
  });

  return sendTranscription({
    url,
    apiKey,
    body,
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
  });
}
