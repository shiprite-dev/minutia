// ---------------------------------------------------------------------------
// Groq Whisper client (primary provider).
//
// Groq exposes an OpenAI-compatible audio endpoint (multipart form-data) and a
// generous free tier (whisper-large-v3, ~5-7% WER, 25MB/request). `verbose_json`
// makes the response include a `duration` field.
// ---------------------------------------------------------------------------

import { sendTranscription, type TranscriptionResult } from "./shared";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_DEFAULT_MODEL = "whisper-large-v3";

export interface GroqTranscribeOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fileName?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function transcribeWithGroq(
  audio: Blob,
  {
    apiKey,
    model = GROQ_DEFAULT_MODEL,
    baseUrl = GROQ_BASE_URL,
    fileName = "meeting-audio.webm",
    timeoutMs,
    signal,
  }: GroqTranscribeOptions
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", audio, fileName);
  form.append("model", model);
  form.append("response_format", "verbose_json");

  // Multipart: let fetch set the Content-Type (boundary) from the FormData body.
  return sendTranscription({
    url: `${baseUrl}/audio/transcriptions`,
    apiKey,
    body: form,
    model,
    provider: "groq",
    timeoutMs,
    signal,
  });
}
