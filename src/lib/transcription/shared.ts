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

type TranscriptionEnv = Record<string, string | undefined>;

/** Providers that return real speaker-labelled segments. */
export const DIARIZING_PROVIDERS: ReadonlySet<TranscriptionProvider> = new Set(["assemblyai", "local"]);

/** The local sidecar's URL is its credential; there is no API key. */
export function localSidecarUrl(env: TranscriptionEnv): string | null {
  return env.TRANSCRIPTION_LOCAL_URL?.trim() || null;
}

/** API key for a provider (OpenRouter falls back to AI_API_KEY per config resolution). */
export function providerApiKey(provider: TranscriptionProvider, env: TranscriptionEnv): string | null {
  if (provider === "groq") return env.GROQ_API_KEY?.trim() || null;
  if (provider === "assemblyai") return env.ASSEMBLYAI_API_KEY?.trim() || null;
  if (provider === "openrouter") return env.OPENROUTER_API_KEY?.trim() || env.AI_API_KEY?.trim() || null;
  return null;
}

/** Whether a provider has the credential it needs: a URL for local, an API key otherwise. */
export function providerConfigured(provider: TranscriptionProvider, env: TranscriptionEnv): boolean {
  if (provider === "local") return localSidecarUrl(env) != null;
  return providerApiKey(provider, env) != null;
}

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
  /** Explicit terminal outcome. "no_speech" is confirmed silence: the provider
   * finished and produced no speech. Only set when the provider supplied
   * positive evidence of silence, never inferred from a malformed payload. */
  outcome?: "speech" | "no_speech";
  /** Provider segment timings (seconds) when every reported segment is well formed. */
  timed?: { start: number; end: number; text: string }[];
}

/** Trusts provider `segments` only when every entry has numeric start/end and string text. */
function parseTimed(segments: unknown): TranscriptionResult["timed"] {
  if (!Array.isArray(segments) || segments.length === 0) return undefined;
  const valid = segments.every(
    (s) => typeof s?.start === "number" && typeof s?.end === "number" && typeof s?.text === "string"
  );
  return valid ? segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })) : undefined;
}

export type TranscriptionErrorCode =
  | "no_api_key"
  | "provider_not_configured"
  | "rate_limit"
  | "timeout"
  | "unsupported_format"
  | "auth_error"
  | "provider_error"
  // Reserved for a recording revision or input-identity mismatch (durable
  // worker, PR 3). No current route emits it; the code exists so clients can
  // map it without a later protocol change.
  | "input_mismatch";

/** Typed failure so the route can map a cause to the right HTTP status. */
export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly status?: number;
  readonly provider?: TranscriptionProvider;
  /** Provider-requested wait (Retry-After) in milliseconds, when it sent one. */
  readonly retryAfterMs?: number;

  constructor(
    code: TranscriptionErrorCode,
    message: string,
    options: {
      status?: number;
      provider?: TranscriptionProvider;
      retryAfterMs?: number;
      cause?: unknown;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "TranscriptionError";
    this.code = code;
    this.status = options.status;
    this.provider = options.provider;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Retry-After is either delta-seconds or an HTTP-date. Non-positive or
 * unparsable values yield null so callers keep their normal backoff. */
export function parseRetryAfterMs(raw: string | null | undefined, now = Date.now()): number | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? Math.max(1, Math.round(seconds * 1000)) : null;
  }

  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  const delta = at - now;
  return delta > 0 ? delta : null;
}

const DEFAULT_TIMEOUT_MS = 120_000; // transcription is slow; Groq does ~1hr audio in ~10s

/** Map a provider HTTP status to a transcription error code. */
export function mapHttpStatusToCode(status: number): TranscriptionErrorCode {
  if (status === 429) return "rate_limit";
  // 401/403 mean the credential itself was rejected: retrying cannot help and a
  // same-provider retry only burns the attempt budget.
  if (status === 401 || status === 403) return "auth_error";
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
  /** Absolute deadline (Date.now() based) for the whole request including
   * body consumption. Clamps timeoutMs so no phase borrows time the request
   * budget does not have. */
  deadlineAt?: number;
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
  deadlineAt,
}: SendTranscriptionInput): Promise<TranscriptionResult> {
  // Clamp the attempt to the remaining request budget; an exhausted request
  // makes zero provider calls instead of borrowing time it does not have.
  if (deadlineAt != null) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      throw new TranscriptionError("timeout", "Transcription request budget exhausted", { provider });
    }
    timeoutMs = Math.min(timeoutMs, remaining);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  // An already-aborted signal never fires a newly added listener, so forward
  // the cancellation explicitly before any request is sent.
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort);
  const stopTimer = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  };

  let response: {
    ok: boolean;
    status: number;
    headers?: { get(name: string): string | null };
    json(): Promise<unknown>;
    text(): Promise<string>;
  };
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, ...headers },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    stopTimer();
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new TranscriptionError(
      aborted ? "timeout" : "provider_error",
      aborted ? `Transcription timed out after ${timeoutMs}ms` : "Transcription request failed",
      { provider, cause: error }
    );
  }

  // Keep the abort timer armed through body consumption and validation so a
  // hung success or error body cannot outlive the budget (headers alone are
  // not liveness evidence).
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch (error) {
      stopTimer();
      throw new TranscriptionError("timeout", "Transcription provider hung on the error body", {
        provider,
        cause: error,
      });
    }
    stopTimer();
    const retryAfterMs = parseRetryAfterMs(response.headers?.get("retry-after"));
    throw new TranscriptionError(
      mapHttpStatusToCode(response.status),
      `Transcription provider returned ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`,
      { status: response.status, provider, retryAfterMs: retryAfterMs ?? undefined }
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    stopTimer();
    throw new TranscriptionError("provider_error", "Transcription provider returned invalid JSON", {
      provider,
      cause: error,
    });
  }
  stopTimer();

  const record = (data ?? {}) as Record<string, unknown>;
  if (typeof record.text !== "string") {
    throw new TranscriptionError("provider_error", "Transcription response missing text", { provider });
  }

  const durationSeconds = getDuration
    ? getDuration(record)
    : typeof record.duration === "number"
      ? record.duration
      : null;

  // An empty transcript from a completed provider job is confirmed silence,
  // not a failure: persist it as no_speech so silence completes once.
  const outcome = record.text.trim() === "" ? "no_speech" : "speech";
  const timed = parseTimed(record.segments);
  return { text: record.text, model, provider, durationSeconds, diarized: false, outcome, ...(timed ? { timed } : {}) };
}
