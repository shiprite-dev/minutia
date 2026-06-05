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
