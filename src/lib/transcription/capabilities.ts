// ---------------------------------------------------------------------------
// Explicit language capability matrix.
//
// Only an explicit caller-supplied hint is ever used. There is no language
// auto-detection here: guessing from audio, participant names, or a prior
// transcript is a wrong-language hallucination risk, so an absent or
// unrecognized hint leaves the provider chain untouched.
// ---------------------------------------------------------------------------

import { DIARIZING_PROVIDERS, providerConfigured, type TranscriptionProvider } from "./shared";

type Env = Record<string, string | undefined>;

// OpenAI Whisper's 99 supported languages (whisper-large-v3 on Groq, whisper-1
// through OpenRouter, and WhisperX locally all share this set):
// https://github.com/openai/whisper#available-models-and-languages
const WHISPER_LANGUAGES = [
  "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", "ca",
  "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fo", "fr",
  "gl", "gu", "ha", "haw", "he", "hi", "hr", "hu", "hy", "id", "is", "it", "ja",
  "jw", "ka", "kk", "km", "kn", "ko", "la", "lb", "ln", "lo", "lt", "lv", "mg",
  "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "ne", "nl", "nn", "no", "oc",
  "pa", "pl", "ps", "pt", "ro", "ru", "sa", "sd", "si", "sk", "sl", "sn", "so",
  "sq", "sr", "su", "sv", "sw", "ta", "te", "tg", "th", "tk", "tl", "tr", "tt",
  "uk", "ur", "uz", "vi", "yi", "yo", "zh",
];

// AssemblyAI Universal's documented multilingual set. Deliberately narrower
// than Whisper: a language absent here is not claimed, even if another
// provider could handle it.
// https://www.assemblyai.com/docs/speech-to-text/pre-recorded-audio/supported-languages
const ASSEMBLYAI_LANGUAGES = [
  "en", "es", "fr", "de", "it", "pt", "nl", "hi", "ja", "zh", "fi", "ko", "pl",
  "ru", "tr", "uk", "vi",
];

const PROVIDER_LANGUAGES: Record<TranscriptionProvider, string[]> = {
  groq: WHISPER_LANGUAGES,
  openrouter: WHISPER_LANGUAGES,
  local: WHISPER_LANGUAGES,
  assemblyai: ASSEMBLYAI_LANGUAGES,
  deepgram: [],
};

const ALIASES: Record<string, string> = {
  eng: "en",
  spa: "es",
  jpn: "ja",
  zho: "zh",
  cmn: "zh",
  hin: "hi",
  ara: "ar",
  fra: "fr",
  deu: "de",
  por: "pt",
  rus: "ru",
  kor: "ko",
};

const SUPPORTED_LANGUAGES = new Set([...WHISPER_LANGUAGES, ...ASSEMBLYAI_LANGUAGES]);
const LANGUAGE_SETS = new Map(
  (Object.keys(PROVIDER_LANGUAGES) as TranscriptionProvider[]).map((provider) => [
    provider,
    new Set(PROVIDER_LANGUAGES[provider]),
  ])
);

/** Normalize an explicit hint to ISO-639-1, or null when it is not supported. */
export function normalizeLanguageHint(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const alias = ALIASES[value];
  if (alias) return alias;
  return SUPPORTED_LANGUAGES.has(value) ? value : null;
}

export function providerSupportsLanguage(provider: TranscriptionProvider, lang: string): boolean {
  const normalized = normalizeLanguageHint(lang);
  if (!normalized) return false;
  return LANGUAGE_SETS.get(provider)?.has(normalized) ?? false;
}

/**
 * Narrow the chain to providers that claim the hinted language. An empty
 * result falls back to the original chain so the caller always has something
 * to run; a null hint is a no-op.
 */
export function selectChainForLanguage(
  chain: TranscriptionProvider[],
  hint: string | null | undefined,
  _env: Env = process.env
): TranscriptionProvider[] {
  const language = normalizeLanguageHint(hint);
  if (!language) return chain;
  const filtered = chain.filter((provider) => providerSupportsLanguage(provider, language));
  return filtered.length > 0 ? filtered : chain;
}

/** Diagnostics only: what each provider claims and whether it has a credential. */
export function describeCapabilities(env: Env = process.env): {
  provider: TranscriptionProvider;
  languages: string[];
  diarizes: boolean;
  configured: boolean;
}[] {
  return (Object.keys(PROVIDER_LANGUAGES) as TranscriptionProvider[]).map((provider) => ({
    provider,
    languages: [...PROVIDER_LANGUAGES[provider]],
    diarizes: DIARIZING_PROVIDERS.has(provider),
    configured: providerConfigured(provider, env),
  }));
}
