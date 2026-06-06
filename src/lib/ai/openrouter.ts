import { getAiModels } from "./model";

// Shared OpenRouter transport for every Minutia AI feature. Owns the wire
// format, key resolution, and resilience (timeout, retry, model fallback) so
// no route re-implements the call.
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;

export function getOpenRouterApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY || null;
}

export type OpenRouterResult = { data: unknown; model: string };

async function requestModel(input: {
  model: string;
  system: string;
  prompt: string;
  apiKey: string;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.SITE_URL ?? "https://example.com",
        "X-Title": "Minutia",
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Provider request failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function callOpenRouter(input: {
  apiKey: string;
  system: string;
  prompt: string;
  models?: string[];
  timeoutMs?: number;
  retries?: number;
}): Promise<OpenRouterResult> {
  const models = (input.models ?? getAiModels()).filter(Boolean);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = input.retries ?? DEFAULT_RETRIES;

  let lastError: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await requestModel({
          model,
          system: input.system,
          prompt: input.prompt,
          apiKey: input.apiKey,
          timeoutMs,
        });
        return { data, model };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Provider request failed");
}
