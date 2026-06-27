import { getInstanceConfigMap } from "@/lib/instance-config";

export type AiProvider = "openai-compatible" | "anthropic";

export type AiConfig = {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

const VALID_PROVIDERS = new Set<string>(["openai-compatible", "anthropic"]);
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://openrouter.ai/api/v1";
const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

// Returns the first non-null, non-empty string from the provided values.
function pick(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (v != null && v !== "") return v;
  }
  return null;
}

export function resolveAiConfig(
  map: Record<string, string | null>,
  env: NodeJS.ProcessEnv
): AiConfig | null {
  // provider: map -> env -> implicit default when any key is present -> null
  let provider: AiProvider;
  const rawProvider = pick(map.ai_provider, env.AI_PROVIDER);
  if (rawProvider !== null) {
    if (!VALID_PROVIDERS.has(rawProvider)) return null;
    provider = rawProvider as AiProvider;
  } else if (
    pick(map.ai_api_key, env.AI_API_KEY, env.OPENROUTER_API_KEY) !== null
  ) {
    // Any api key present (map or env) is enough to infer openai-compatible.
    provider = "openai-compatible";
  } else {
    return null;
  }

  // apiKey: map -> AI_API_KEY -> OPENROUTER_API_KEY
  const apiKey = pick(map.ai_api_key, env.AI_API_KEY, env.OPENROUTER_API_KEY);
  if (apiKey === null) return null;

  // model: map -> AI_MODEL -> OPENROUTER_MODEL -> default
  const model =
    pick(map.ai_model, env.AI_MODEL, env.OPENROUTER_MODEL) ?? DEFAULT_MODEL;

  // baseUrl: anthropic always uses canonical URL; openai-compatible: map -> env -> default
  let baseUrl: string;
  if (provider === "anthropic") {
    baseUrl = ANTHROPIC_BASE_URL;
  } else {
    baseUrl =
      pick(map.ai_base_url, env.AI_BASE_URL) ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL;
    baseUrl = baseUrl.replace(/\/$/, "");
  }

  return { provider, baseUrl, apiKey, model };
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const map = await getInstanceConfigMap([
    "ai_provider",
    "ai_base_url",
    "ai_api_key",
    "ai_model",
  ]);
  return resolveAiConfig(map, process.env);
}

export async function hasAiConfigured(): Promise<boolean> {
  return (await getAiConfig()) !== null;
}
