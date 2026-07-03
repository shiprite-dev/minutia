// ---------------------------------------------------------------------------
// Shared transcription primitives.
//
// Leaf module (no imports from the provider clients or the router) so groq.ts,
// openrouter-stt.ts, and index.ts can all depend on it without import cycles.
// Owns the result/error shapes plus one transport (`sendTranscription`) that
// does the fetch, timeout, error mapping, and response normalization. Each
// provider supplies its own request body (Groq: multipart; OpenRouter: base64
// JSON) and a duration extractor.
// ---------------------------------------------------------------------------

export type TranscriptionProvider = "groq" | "openrouter" | "assemblyai" | "deepgram" | "local";

export interface TranscriptionSegment {
  /** Provider speaker label, e.g. "A", "B", or "SPEAKER_00". */
  speaker: string;
  /** Segment start/end in seconds from the recording start. */
  start: number;
  end: number;
  text: string;
  /** Provider confidence 0..1 when reported, else null. */
  confidence: number | null;
}

export interface TranscriptionResult {
  /** The transcribed text. */
  text: string;
  /** Model that produced the transcript (for the meeting's audit trail). */
  model: string;
  /** Provider that answered (primary or fallback). */
  provider: TranscriptionProvider;
  /** Audio length in seconds when the provider reports it, else null. */
  durationSeconds: number | null;
  /** Speaker-labelled segments when the provider diarizes, else omitted. */
  segments?: TranscriptionSegment[];
  /** True only when segments carry real speaker labels. */
  diarized: boolean;
}

export type TranscriptionErrorCode =
  | "no_api_key"
  | "provider_not_configured"
  | "rate_limit"
  | "timeout"
  | "unsupported_format"
  | "provider_error";

/** Typed failure so the route can map a cause to the right HTTP status. */
export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly status?: number;
  readonly provider?: TranscriptionProvider;

  constructor(
    code: TranscriptionErrorCode,
    message: string,
    options: { status?: number; provider?: TranscriptionProvider; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "TranscriptionError";
    this.code = code;
    this.status = options.status;
    this.provider = options.provider;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000; // transcription is slow; Groq does ~1hr audio in ~10s

/** Map a provider HTTP status to a transcription error code. */
export function mapHttpStatusToCode(status: number): TranscriptionErrorCode {
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 415 || status === 422) return "unsupported_format";
  return "provider_error";
}

export interface SendTranscriptionInput {
  url: string;
  apiKey: string;
  /** Pre-built request body (FormData for multipart, string for JSON). */
  body: BodyInit;
  model: string;
  provider: TranscriptionProvider;
  /** Extra headers (Content-Type for JSON, attribution, etc.). */
  headers?: Record<string, string>;
  /** Pull the audio duration out of the provider's response, if it reports one. */
  getDuration?: (json: Record<string, unknown>) => number | null;
  timeoutMs?: number;
  /** Caller cancellation, combined with the internal timeout. */
  signal?: AbortSignal;
}

/** POST to a transcription endpoint and normalize the response, or throw a typed error. */
export async function sendTranscription({
  url,
  apiKey,
  body,
  model,
  provider,
  headers,
  getDuration,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}: SendTranscriptionInput): Promise<TranscriptionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  let response: { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> };
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, ...headers },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new TranscriptionError(
      aborted ? "timeout" : "provider_error",
      aborted ? `Transcription timed out after ${timeoutMs}ms` : "Transcription request failed",
      { provider, cause: error }
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    // Surface the provider's own reason (e.g. "model not found") for debugging.
    const detail = await response.text().catch(() => "");
    throw new TranscriptionError(
      mapHttpStatusToCode(response.status),
      `Transcription provider returned ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`,
      { status: response.status, provider }
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    throw new TranscriptionError("provider_error", "Transcription provider returned invalid JSON", {
      provider,
      cause: error,
    });
  }

  const record = (data ?? {}) as Record<string, unknown>;
  if (typeof record.text !== "string") {
    throw new TranscriptionError("provider_error", "Transcription response missing text", { provider });
  }

  const durationSeconds = getDuration
    ? getDuration(record)
    : typeof record.duration === "number"
      ? record.duration
      : null;

  return { text: record.text, model, provider, durationSeconds, diarized: false };
}
