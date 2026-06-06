// Resolve the AI model from runtime config.
// Configure with OPENROUTER_MODEL (or AI_MODEL); falls back to a sensible default.
const DEFAULT_AI_MODEL = "google/gemini-3.1-flash-lite";

export function getAiModel() {
  return (
    process.env.OPENROUTER_MODEL?.trim() ||
    process.env.AI_MODEL?.trim() ||
    DEFAULT_AI_MODEL
  );
}

// Ordered model list for resilient calls: the configured model first, then a
// cheap, widely available fallback (AI_MODEL_FALLBACK, else the default).
export function getAiModels() {
  const primary = getAiModel();
  const fallback = process.env.AI_MODEL_FALLBACK?.trim() || DEFAULT_AI_MODEL;
  return primary === fallback ? [primary] : [primary, fallback];
}
