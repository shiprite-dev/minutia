import { validateAiBaseUrl } from "../validate-url";

// Streaming sibling of callOpenAiCompatible: same endpoint and headers, but
// stream:true and a manual SSE parse of choices[0].delta.content. No new
// dependency. reasoning_effort is sent only when provided so a reasoning model
// cannot burn a long TTFT; strict endpoints that 400 on the unknown field get
// exactly one retry with it stripped.
export async function* streamOpenAiCompatible(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
  reasoningEffort?: "minimal";
}): AsyncGenerator<string> {
  const validation = validateAiBaseUrl(input.baseUrl);
  if (!validation.ok) {
    throw new Error(`Invalid AI base URL: ${validation.reason}`);
  }
  const normalizedUrl = validation.url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort);

  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.prompt },
    ],
    stream: true,
  };
  if (input.reasoningEffort) body.reasoning_effort = input.reasoningEffort;

  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.SITE_URL ?? "https://example.com",
    "X-Title": "Minutia",
  };

  try {
    let response = await fetch(`${normalizedUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.status === 400 && input.reasoningEffort) {
      const retryBody = { ...body };
      delete retryBody.reasoning_effort;
      response = await fetch(`${normalizedUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(retryBody),
        signal: controller.signal,
      });
    }

    if (!response.ok || !response.body) {
      throw new Error(`Provider stream failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data) as {
            choices?: { delta?: { content?: unknown } }[];
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        } catch {
          // Partial or non-JSON keepalive line; ignore.
        }
      }
    }
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
}
