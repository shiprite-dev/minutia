import { getAiConfig, type AiConfig } from "./config";
import { AiNotConfiguredError, dispatchAi } from "./call";
import { getTextFromOpenRouter } from "./ask-series-answer";
import { streamOpenAiCompatible } from "./providers/openai-compatible-stream";

// Honest streaming transport. openai-compatible providers stream real tokens;
// anthropic (and any non-streaming provider) fall back to one blocking call
// yielded as a single delta so the flowing recap still works everywhere. The
// operator-resolved AiConfig picks the model; we never hardcode one.
export async function* streamAi(input: {
  system: string;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  reasoningEffort?: "minimal";
  config?: AiConfig | null;
}): AsyncGenerator<string> {
  const config = input.config ?? (await getAiConfig());
  if (!config) throw new AiNotConfiguredError("AI is not configured.");
  const timeoutMs = input.timeoutMs ?? 60_000;

  if (config.provider === "openai-compatible") {
    yield* streamOpenAiCompatible({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      system: input.system,
      prompt: input.prompt,
      timeoutMs,
      signal: input.signal,
      reasoningEffort: input.reasoningEffort ?? "minimal",
    });
    return;
  }

  const { data } = await dispatchAi(config, {
    system: input.system,
    prompt: input.prompt,
    timeoutMs,
  });
  const text = getTextFromOpenRouter(data);
  if (text) yield text;
}
