// Pure SSE framing shared by the summary stream route (encode) and the
// FlowingSummary client (decode). One word per frame; a [DONE] sentinel ends
// the stream; a bare comment ":" is a heartbeat the client ignores.

export const SSE_DONE = "data: [DONE]\n\n";
export const SSE_HEARTBEAT = ":\n\n";

export function formatSseFrame(word: string): string {
  return `data: ${JSON.stringify({ t: word })}\n\n`;
}

// A one-off meta frame naming the model powering the recap, emitted before the
// words so the client can render provenance. Empty model yields no frame.
export function formatSseMeta(model: string): string {
  if (!model) return "";
  return `data: ${JSON.stringify({ m: model })}\n\n`;
}

export function parseSseFrame(line: string): { word?: string; model?: string; done?: boolean } {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return {};
  const data = trimmed.slice(5).trim();
  if (data === "[DONE]") return { done: true };
  try {
    const parsed = JSON.parse(data) as { t?: unknown; m?: unknown };
    if (typeof parsed.t === "string") return { word: parsed.t };
    if (typeof parsed.m === "string" && parsed.m) return { model: parsed.m };
    return {};
  } catch {
    return {};
  }
}
