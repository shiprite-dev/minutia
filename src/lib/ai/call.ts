import { getAiConfig, type AiConfig } from "./config";
import { callOpenAiCompatible } from "./providers/openai-compatible";
import { callAnthropic } from "./providers/anthropic";

export class AiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

function extractAnthropicText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.content) || r.content.length === 0) return "";
  const textItem =
    r.content.find(
      (item: unknown) =>
        item != null &&
        typeof item === "object" &&
        (item as Record<string, unknown>).type === "text"
    ) ?? r.content[0];
  if (!textItem || typeof textItem !== "object") return "";
  const text = (textItem as Record<string, unknown>).text;
  return typeof text === "string" ? text : "";
}

export async function dispatchAi(
  config: AiConfig,
  input: {
    system: string;
    prompt: string;
    timeoutMs?: number;
    retries?: number;
  }
): Promise<{ data: unknown; model: string }> {
  const timeoutMs = input.timeoutMs ?? 30000;
  const retries = input.retries ?? 1;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let data: unknown;
      if (config.provider === "anthropic") {
        const raw = await callAnthropic({
          apiKey: config.apiKey,
          model: config.model,
          system: input.system,
          prompt: input.prompt,
          timeoutMs,
        });
        const text = extractAnthropicText(raw);
        data = { choices: [{ message: { content: text } }] };
      } else {
        data = await callOpenAiCompatible({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          system: input.system,
          prompt: input.prompt,
          timeoutMs,
        });
      }
      return { data, model: config.model };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("AI provider request failed");
}

export async function callAi(input: {
  system: string;
  prompt: string;
  timeoutMs?: number;
  retries?: number;
}): Promise<{ data: unknown; model: string }> {
  const config = await getAiConfig();
  if (!config) throw new AiNotConfiguredError("AI is not configured.");
  return dispatchAi(config, input);
}
