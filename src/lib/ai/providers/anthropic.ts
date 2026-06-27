export async function callAnthropic(input: {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  timeoutMs: number;
  maxTokens?: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxTokens ?? 1024,
        system: input.system,
        messages: [{ role: "user", content: input.prompt }],
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
