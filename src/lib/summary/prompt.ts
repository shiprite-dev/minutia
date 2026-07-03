// Prose recap prompt for the streamed summary. Distinct from enhance-notes /
// suggestions (which demand JSON); a flowing recap is human-readable prose. The
// context shape (Series / Meeting / Attendees / Transcript) mirrors the
// enhance-notes user prompt so we reuse the mental model, not the output format.

export const SUMMARY_SYSTEM_PROMPT =
  "You write a concise, flowing recap of a recurring meeting for Minutia. Return prose only: two or three short paragraphs a busy teammate can read in under a minute. No headings, no bullet lists, no structured data, no markdown fences. Lead with what was decided and who owns what. Do not invent owners, dates, or decisions; if the transcript is thin, keep the recap short.";

const MAX_TRANSCRIPT_CHARS = 80_000;

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[... truncated ...]` : text;
}

export function buildSummaryPrompt(input: {
  title: string;
  seriesName: string;
  attendees: string[];
  transcript: string;
}): string {
  return [
    "Write the recap for this meeting.",
    "",
    `Series: ${clamp(input.seriesName, 200)}`,
    `Meeting: ${clamp(input.title, 200)}`,
    `Attendees: ${clamp(input.attendees.join(", ") || "Unknown", 500)}`,
    "",
    "Transcript:",
    clamp(input.transcript, MAX_TRANSCRIPT_CHARS),
  ].join("\n");
}
