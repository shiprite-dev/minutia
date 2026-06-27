import { validateAiBaseUrl } from "../validate-url";

export async function callOpenAiCompatible(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  timeoutMs: number;
}): Promise<unknown> {
  const validation = validateAiBaseUrl(input.baseUrl);
  if (!validation.ok) {
    throw new Error(`Invalid AI base URL: ${validation.reason}`);
  }
  const normalizedUrl = validation.url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(`${normalizedUrl}/chat/completions`, {
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
