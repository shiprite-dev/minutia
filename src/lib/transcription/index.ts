// ---------------------------------------------------------------------------
// Transcription provider router.
//
// Resolves TRANSCRIPTION_PROVIDER (groq | openrouter | assemblyai | deepgram |
// local), orders providers (configured primary first, OpenRouter as resilient
// fallback), and runs the audio through the first one that succeeds. Provider
// clients are dependency-injected their credential (API key, or a URL for the
// local sidecar) so this module owns all env reads in one place and stays
// unit-testable with an injected `env`.
// ---------------------------------------------------------------------------

import { transcribeWithGroq } from "./groq";
import { transcribeWithOpenRouter } from "./openrouter-stt";
import { transcribeWithAssemblyAI } from "./assemblyai";
import { transcribeWithLocalSidecar } from "./local-sidecar";
import {
  backoffMs,
  classifyFailure,
  createRunBudget,
  nextDecision,
  recordAttempt,
  type RunBudget,
} from "./budget";
import { selectChainForLanguage } from "./capabilities";
import {
  DIARIZING_PROVIDERS,
  TranscriptionError,
  localSidecarUrl,
  providerApiKey,
  providerConfigured,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "./shared";

export {
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL,
  transcribeWithGroq,
} from "./groq";
export {
  OPENROUTER_STT_URL,
  OPENROUTER_STT_DEFAULT_MODEL,
  transcribeWithOpenRouter,
} from "./openrouter-stt";
export {
  ASSEMBLYAI_BASE_URL,
  ASSEMBLYAI_DEFAULT_MODEL,
  transcribeWithAssemblyAI,
} from "./assemblyai";
export { LOCAL_STT_DEFAULT_MODEL, transcribeWithLocalSidecar } from "./local-sidecar";
export {
  MAX_TRANSCRIPTION_BYTES,
  needsChunking,
  findWebmClusterOffsets,
  planWebmChunks,
  chunkAudioBlob,
} from "./chunk";
export {
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
  type TranscriptionErrorCode,
  type TranscriptionSegment,
} from "./shared";
export {
  resolveSpeakerMap,
  flattenSegments,
  type SpeakerProposal,
  type SpeakerMapResult,
} from "./diarization";
export { assembleDiarizedTranscript, type DiarizedAssembly } from "./assemble";
export {
  BUDGET_LIMITS,
  backoffMs,
  classifyFailure,
  createRunBudget,
  nextDecision,
  recordAttempt,
  type FailureClass,
  type RetryClass,
  type RunBudget,
} from "./budget";
export {
  describeCapabilities,
  normalizeLanguageHint,
  providerSupportsLanguage,
  selectChainForLanguage,
} from "./capabilities";

type Env = Record<string, string | undefined>;

const VALID_PROVIDERS: readonly TranscriptionProvider[] = ["groq", "openrouter", "assemblyai", "deepgram", "local"];

/** Providers with a real client in this build. deepgram is reserved. */
const IMPLEMENTED_PROVIDERS = new Set<TranscriptionProvider>(["groq", "openrouter", "assemblyai", "local"]);

/** The configured primary provider; unknown values fall back to groq. */
export function resolveTranscriptionProvider(env: Env = process.env): TranscriptionProvider {
  const raw = env.TRANSCRIPTION_PROVIDER?.trim() as TranscriptionProvider | undefined;
  return raw && VALID_PROVIDERS.includes(raw) ? raw : "groq";
}

/**
 * Ordered attempt list: configured primary, then OpenRouter as fallback.
 *
 * A local-only deployment must never silently send audio to a cloud provider:
 * when the primary is "local", OpenRouter is appended only if the operator
 * explicitly opted in with TRANSCRIPTION_ALLOW_CLOUD_FALLBACK=true.
 */
export function getProviderChain(env: Env = process.env): TranscriptionProvider[] {
  const primary = resolveTranscriptionProvider(env);
  const chain: TranscriptionProvider[] = [primary];
  if (primary === "local" && !allowsCloudFallback(env)) return chain;
  if (primary !== "openrouter" && providerApiKey("openrouter", env)) chain.push("openrouter");
  return chain;
}

/** Explicit opt-in for cloud egress when the primary engine is local. */
export function allowsCloudFallback(env: Env = process.env): boolean {
  return env.TRANSCRIPTION_ALLOW_CLOUD_FALLBACK?.trim().toLowerCase() === "true";
}

/**
 * Reorder an attempt list to prefer fast, non-diarizing providers (groq,
 * openrouter). Diarizing a short WebM segment is pointless and burns the
 * expensive diarizing provider, so the per-segment fast lane calls this to skip
 * assemblyai/local. When no non-diarizing provider is configured the original
 * chain is returned unchanged so the lane still has something to run.
 */
export function orderChainPreferFast(
  chain: TranscriptionProvider[],
  env: Env = process.env
): TranscriptionProvider[] {
  const fast = (["groq", "openrouter"] as TranscriptionProvider[]).filter((p) => providerConfigured(p, env));
  return fast.length > 0 ? fast : chain;
}

/** True when at least one implemented provider in the chain has its credential configured. */
export function isTranscriptionConfigured(env: Env = process.env): boolean {
  return getProviderChain(env).some((p) => IMPLEMENTED_PROVIDERS.has(p) && providerConfigured(p, env));
}

/** True when the resolved primary provider returns real speaker-labelled segments. */
export function isDiarizingProvider(env: Env = process.env): boolean {
  return DIARIZING_PROVIDERS.has(resolveTranscriptionProvider(env));
}

/**
 * True only when the resolved primary is a diarizing provider AND actually
 * configured. isDiarizingProvider() alone is not enough to gate the no-chunk
 * path: a diarizing primary with no credential still resolves as "diarizing"
 * even though transcribeAudio() would silently run the fallback (which may
 * not diarize), so an unchunked large file could be sent somewhere unable to
 * handle it.
 */
export function isDiarizingProviderConfigured(env: Env = process.env): boolean {
  const primary = resolveTranscriptionProvider(env);
  return DIARIZING_PROVIDERS.has(primary) && providerConfigured(primary, env);
}

export interface TranscribeAudioOptions {
  fileName?: string;
  /** Source container MIME type, used by providers that need an explicit format. */
  mimeType?: string;
  /** Known roster size, fed to diarizing providers as a labeling hint. */
  speakersExpected?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Prefer fast, non-diarizing providers (used by the per-segment fast lane). */
  preferFast?: boolean;
  /** Inject an env for tests; defaults to process.env. */
  env?: Env;
  /** Absolute request deadline (Date.now() based). Clamps every provider
   * attempt to the remaining request budget so retries, fallbacks, and later
   * chunks never receive fresh time. */
  deadlineAt?: number;
  /** Explicit language hint used to narrow the provider chain. Never inferred
   * from audio, participant names, or a prior transcript. */
  languageHint?: string;
  /** Inject a run budget for tests; one is created per call otherwise. */
  budget?: RunBudget;
}

function runProvider(
  provider: TranscriptionProvider,
  audio: Blob,
  credential: string,
  options: TranscribeAudioOptions
): Promise<TranscriptionResult> {
  if (provider === "assemblyai") {
    return transcribeWithAssemblyAI(audio, {
      apiKey: credential,
      speakersExpected: options.speakersExpected,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      deadlineAt: options.deadlineAt,
    });
  }
  if (provider === "local") {
    return transcribeWithLocalSidecar(audio, {
      url: credential,
      speakersExpected: options.speakersExpected,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      deadlineAt: options.deadlineAt,
    });
  }
  if (provider === "groq") {
    return transcribeWithGroq(audio, {
      apiKey: credential,
      fileName: options.fileName,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      deadlineAt: options.deadlineAt,
    });
  }
  return transcribeWithOpenRouter(audio, {
    apiKey: credential,
    mimeType: options.mimeType,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    deadlineAt: options.deadlineAt,
  });
}

/** Backoff wait that ends immediately when the caller cancels. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });
}

/**
 * Transcribe a recording, trying providers in order until one succeeds. Each
 * run gets a bounded retry/fallback budget: one same-provider retry for a
 * transient failure, one provider switch, three attempts total. Throws a
 * TranscriptionError ('provider_not_configured' when nothing is set up, else
 * the primary provider's failure, which is the most actionable root cause) so
 * the route can map it to an HTTP status.
 */
export async function transcribeAudio(
  audio: Blob,
  options: TranscribeAudioOptions = {}
): Promise<TranscriptionResult> {
  const env = options.env ?? process.env;
  if (!isTranscriptionConfigured(env)) {
    throw new TranscriptionError("provider_not_configured", "No transcription provider is configured");
  }

  const baseChain = options.preferFast ? orderChainPreferFast(getProviderChain(env), env) : getProviderChain(env);
  const chain = selectChainForLanguage(baseChain, options.languageHint, env);
  const budget = options.budget ?? createRunBudget();

  let firstError: unknown;
  let index = 0;
  let attemptKind: "first" | "retry" | "switch" = "first";

  while (index < chain.length) {
    if (options.signal?.aborted) break;
    const provider = chain[index];
    if (!IMPLEMENTED_PROVIDERS.has(provider)) {
      index += 1;
      continue;
    }
    const credential = provider === "local" ? localSidecarUrl(env) : providerApiKey(provider, env);
    if (!credential) {
      index += 1;
      continue;
    }

    recordAttempt(budget, provider, attemptKind);
    try {
      return await runProvider(provider, audio, credential, options);
    } catch (error) {
      if (firstError === undefined) firstError = error;
      // A cancelled caller gets no retry and no fallback.
      if (options.signal?.aborted) break;

      const decision = nextDecision(budget, provider, classifyFailure(error));
      if (decision === "stop") break;

      if (decision === "retry_same") {
        const remaining = options.deadlineAt != null ? options.deadlineAt - Date.now() : undefined;
        if (remaining != null && remaining <= 0) break;
        const retryAfterMs = error instanceof TranscriptionError ? error.retryAfterMs : null;
        const delay = backoffMs(budget.totalAttempts - 1, retryAfterMs, remaining);
        // When the deadline cannot afford the wait, retry immediately rather
        // than sleeping into an already-exhausted budget.
        if (delay > 0 && (remaining == null || remaining > delay)) {
          await sleep(delay, options.signal);
        }
        if (options.signal?.aborted) break;
        attemptKind = "retry";
        continue;
      }

      index += 1;
      attemptKind = "switch";
    }
  }

  throw firstError instanceof TranscriptionError
    ? firstError
    : new TranscriptionError("provider_error", "All transcription providers failed", { cause: firstError });
}
