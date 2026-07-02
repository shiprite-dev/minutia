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
import { TranscriptionError, type TranscriptionProvider, type TranscriptionResult } from "./shared";

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
} from "./shared";
export {
  resolveSpeakerMap,
  flattenSegments,
  type SpeakerProposal,
  type SpeakerMapResult,
} from "./diarization";

type Env = Record<string, string | undefined>;

const VALID_PROVIDERS: readonly TranscriptionProvider[] = ["groq", "openrouter", "assemblyai", "deepgram", "local"];

/** Providers with a real client in this build. deepgram is reserved. */
const IMPLEMENTED_PROVIDERS = new Set<TranscriptionProvider>(["groq", "openrouter", "assemblyai", "local"]);

/** Providers that return real speaker-labelled segments. */
const DIARIZING_PROVIDERS = new Set<TranscriptionProvider>(["assemblyai", "local"]);

/** The local sidecar's URL is its credential; there is no API key. */
function localSidecarUrl(env: Env): string | null {
  return env.TRANSCRIPTION_LOCAL_URL?.trim() || null;
}

/** API key for a provider (OpenRouter falls back to AI_API_KEY per config resolution). */
function providerApiKey(provider: TranscriptionProvider, env: Env): string | null {
  if (provider === "groq") return env.GROQ_API_KEY?.trim() || null;
  if (provider === "assemblyai") return env.ASSEMBLYAI_API_KEY?.trim() || null;
  if (provider === "openrouter") return env.OPENROUTER_API_KEY?.trim() || env.AI_API_KEY?.trim() || null;
  return null;
}

/** Whether a provider has the credential it needs: a URL for local, an API key otherwise. */
function providerConfigured(provider: TranscriptionProvider, env: Env): boolean {
  if (provider === "local") return localSidecarUrl(env) != null;
  return providerApiKey(provider, env) != null;
}

/** The configured primary provider; unknown values fall back to groq. */
export function resolveTranscriptionProvider(env: Env = process.env): TranscriptionProvider {
  const raw = env.TRANSCRIPTION_PROVIDER?.trim() as TranscriptionProvider | undefined;
  return raw && VALID_PROVIDERS.includes(raw) ? raw : "groq";
}

/** Ordered attempt list: configured primary, then OpenRouter as fallback. */
export function getProviderChain(env: Env = process.env): TranscriptionProvider[] {
  const primary = resolveTranscriptionProvider(env);
  const chain: TranscriptionProvider[] = [primary];
  if (primary !== "openrouter" && providerApiKey("openrouter", env)) chain.push("openrouter");
  return chain;
}

/** True when at least one implemented provider in the chain has its credential configured. */
export function isTranscriptionConfigured(env: Env = process.env): boolean {
  return getProviderChain(env).some((p) => IMPLEMENTED_PROVIDERS.has(p) && providerConfigured(p, env));
}

/** True when the resolved primary provider returns real speaker-labelled segments. */
export function isDiarizingProvider(env: Env = process.env): boolean {
  return DIARIZING_PROVIDERS.has(resolveTranscriptionProvider(env));
}

export interface TranscribeAudioOptions {
  fileName?: string;
  /** Source container MIME type, used by providers that need an explicit format. */
  mimeType?: string;
  /** Known roster size, fed to diarizing providers as a labeling hint. */
  speakersExpected?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Inject an env for tests; defaults to process.env. */
  env?: Env;
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
    });
  }
  if (provider === "local") {
    return transcribeWithLocalSidecar(audio, {
      url: credential,
      speakersExpected: options.speakersExpected,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  }
  if (provider === "groq") {
    return transcribeWithGroq(audio, {
      apiKey: credential,
      fileName: options.fileName,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  }
  return transcribeWithOpenRouter(audio, {
    apiKey: credential,
    mimeType: options.mimeType,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
}

/**
 * Transcribe a recording, trying providers in order until one succeeds. Throws
 * a TranscriptionError ('provider_not_configured' when nothing is set up, else
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

  let firstError: unknown;
  for (const provider of getProviderChain(env)) {
    if (!IMPLEMENTED_PROVIDERS.has(provider)) continue;
    const credential = provider === "local" ? localSidecarUrl(env) : providerApiKey(provider, env);
    if (!credential) continue;
    try {
      return await runProvider(provider, audio, credential, options);
    } catch (error) {
      if (firstError === undefined) firstError = error;
    }
  }

  throw firstError instanceof TranscriptionError
    ? firstError
    : new TranscriptionError("provider_error", "All transcription providers failed", { cause: firstError });
}
