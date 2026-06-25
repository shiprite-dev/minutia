import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";
import { getTextFromOpenRouter } from "./ask-series-answer";
import { callOpenRouter } from "./openrouter";
import {
  buildSeriesContext,
  formatSeriesContextForPrompt,
  normalizeSuggestions,
  type SeriesContextClient,
} from "./context-builder";

// MIN-121: Context-aware item extraction.
//
// Shared by the suggestions route (manual "Review AI suggestions") and the
// transcribe route (auto-trigger when a recording finishes). It feeds the model
// the whole series history so it can deduplicate, detect resolutions, follow up
// on prior items, and flag contradictions, then enforces referential integrity
// before anything is written.

export const SUGGESTIONS_PROMPT_VERSION = "ai-suggestions-v2-context";

const SYSTEM_PROMPT =
  "You extract accountable meeting follow-ups using the full history of a recurring meeting series. Return valid JSON only.";

const suggestionSchema = z.object({
  type: z.enum(["new_item", "status_update", "duplicate_warning"]).default("new_item"),
  category: z.enum(["action", "decision", "info", "risk", "blocker"]),
  title: z.string().min(1).max(500),
  details: z.string().default(""),
  owner_name: z.string().default(""),
  due_date: z.iso.date().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  source_excerpt: z.string().default(""),
  // Lenient on the wire (the model occasionally emits 0/negatives); the
  // referential-integrity pass below is the real gate.
  related_issue_number: z.number().int().nullable().default(null),
  suggested_status: z
    .enum(["open", "in_progress", "pending", "resolved", "dropped"])
    .nullable()
    .default(null),
});

const suggestionsSchema = z.object({
  suggestions: z.array(suggestionSchema).default([]),
});

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Bound user-controlled text before it enters the prompt. Keeps the request
// within the model's context window and caps the prompt-injection surface;
// referential integrity is still enforced after the model replies.
const MAX_NOTES_CHARS = 20_000;
const MAX_TRANSCRIPT_CHARS = 80_000;
function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[... truncated ...]` : text;
}

const CATEGORY_GUIDE = [
  "- category: one of action, decision, info, risk, blocker.",
  "    action = a task someone must do. decision = a choice that was made.",
  "    risk = a possible future problem. blocker = something currently preventing progress. info = a durable fact worth tracking.",
].join("\n");

export function buildContextAwarePrompt(input: {
  title: string;
  seriesName: string;
  attendees: string[];
  notes: string;
  transcript: string | null;
  contextBlock: string;
}) {
  return [
    "You extract reviewable accountability suggestions for Minutia, an Outstanding Issues Log (OIL) for a recurring meeting series.",
    "Unlike a one-off meeting summarizer, you are given the full living state of this series below: the open OIL items, recent decisions, and recent status changes. Reason over that history; it is the whole point.",
    "A facilitator reviews every suggestion before it enters the permanent record, so omitting a weak item is always better than inventing one.",
    "",
    "OUTPUT CONTRACT",
    'Return only a single JSON object of the form {"suggestions": [ ... ]}.',
    "Do not wrap it in markdown fences. Do not add commentary, explanations, or text before or after the JSON.",
    'If nothing in the notes or transcript qualifies, return {"suggestions": []}.',
    "",
    "Each suggestion object must have exactly these fields:",
    "- type: one of new_item, status_update, duplicate_warning.",
    "    new_item = a genuinely new item not already tracked in the OIL below.",
    "    status_update = this meeting moved an EXISTING open OIL item forward; set related_issue_number and suggested_status.",
    "    duplicate_warning = this meeting raised something an EXISTING open OIL item already covers; set related_issue_number and do not also create a new_item for it.",
    CATEGORY_GUIDE,
    "- title: concise imperative summary, max 120 characters, no trailing punctuation.",
    '- details: one or two sentences of supporting context, or "" if none.',
    '- owner_name: copy a person\'s name verbatim only if the source explicitly assigns them. Never guess. Use "" when unassigned.',
    "- due_date: an explicit calendar date as YYYY-MM-DD, only if the source states one. Never infer from relative phrasing. Use null otherwise.",
    "- confidence: 0 to 1. Use 0.9+ when explicitly stated and owned, 0.5 to 0.8 when implied, and omit any item you would score below 0.4.",
    "- source_excerpt: a verbatim quote copied from the notes or transcript that supports this item. Do not paraphrase. Keep it under 160 characters.",
    "- related_issue_number: the OIL item number this references (e.g. 45 for OIL-45). Required for status_update and duplicate_warning. Use null for a new_item.",
    "- suggested_status: for a status_update only, the item's new status (open, in_progress, pending, resolved, dropped). Use null otherwise.",
    "",
    "CONTEXT-AWARE RULES (this is what makes Minutia different):",
    "1. Deduplicate: if the discussion raises something an open OIL item already covers, emit a duplicate_warning referencing that item, not a parallel new_item.",
    "2. Detect resolution: if a decision or update resolves or advances an open item, especially an open risk or blocker, emit a status_update with the new status, not a new_item.",
    "3. Follow up: a new development on a prior item is a status_update on that item, not a fresh item.",
    "4. Flag contradictions: if the discussion contradicts a past decision, surface it as a risk new_item and name the prior decision in details.",
    "5. Only emit a new_item for something genuinely not represented in the OIL below.",
    "6. Reference OIL items by their number exactly as shown (OIL-<number>).",
    "7. Prefer fewer, high-signal suggestions. Skip greetings, small talk, and items discussed with no real change.",
    "8. Emit at most 10 suggestions total. If more seem to qualify, keep only the ten highest-confidence ones.",
    "",
    formatSeriesContextHeading(input.contextBlock),
    "",
    `Series: ${clamp(input.seriesName, 200)}`,
    `Meeting: ${clamp(input.title, 200)}`,
    `Attendees: ${clamp(input.attendees.join(", ") || "Unknown", 500)}`,
    "",
    "Transcript:",
    input.transcript ? clamp(input.transcript, MAX_TRANSCRIPT_CHARS) : "(not provided)",
    "",
    "Raw notes:",
    input.notes ? clamp(input.notes, MAX_NOTES_CHARS) : "(empty)",
  ].join("\n");
}

function formatSeriesContextHeading(contextBlock: string) {
  return ["=== SERIES HISTORY (cross-meeting memory) ===", contextBlock].join("\n");
}

export type GenerateOutcome =
  | { ok: true; suggestions: unknown[]; model: string }
  | { ok: false; status: number; error: string };

/**
 * Generate context-aware suggestions for a meeting and persist them, replacing
 * any pending ones. Returns a structured outcome so the suggestions route can
 * map it to an HTTP status while the transcribe route can treat a failure as
 * non-fatal (the transcript is already saved).
 */
export async function generateMeetingSuggestions(
  supabase: SupabaseServerClient,
  meetingId: string,
  apiKey: string
): Promise<GenerateOutcome> {
  const { data: meeting, error } = await supabase
    .from("meetings")
    .select("*, series:meeting_series!inner(name)")
    .eq("id", meetingId)
    .single();

  if (error || !meeting) {
    return { ok: false, status: 404, error: "Meeting not found" };
  }

  const rawNotes = meeting.raw_notes_markdown || meeting.notes_markdown || "";
  if (!rawNotes.trim() && !meeting.transcript_raw?.trim()) {
    return { ok: false, status: 400, error: "Add notes or a transcript before extracting suggestions." };
  }

  const context = await buildSeriesContext(
    supabase as unknown as SeriesContextClient,
    meeting.series_id
  );

  const prompt = buildContextAwarePrompt({
    title: meeting.title,
    seriesName: meeting.series?.name ?? "Untitled series",
    attendees: meeting.attendees ?? [],
    notes: rawNotes,
    transcript: meeting.transcript_raw,
    contextBlock: formatSeriesContextForPrompt(context),
  });

  let providerData: unknown;
  let model: string;
  try {
    ({ data: providerData, model } = await callOpenRouter({ apiKey, system: SYSTEM_PROMPT, prompt }));
  } catch {
    return { ok: false, status: 502, error: "AI provider request failed." };
  }

  let parsed: z.infer<typeof suggestionsSchema>;
  try {
    parsed = suggestionsSchema.parse(JSON.parse(getTextFromOpenRouter(providerData)));
  } catch {
    return { ok: false, status: 502, error: "AI provider returned invalid suggestions." };
  }

  const normalized = normalizeSuggestions(parsed.suggestions, context.openIssues);

  const { error: deleteError } = await supabase
    .from("meeting_ai_suggestions")
    .delete()
    .eq("meeting_id", meetingId)
    .eq("status", "pending");
  if (deleteError) {
    return { ok: false, status: 500, error: "Failed to refresh AI suggestions." };
  }

  if (normalized.length === 0) {
    return { ok: true, suggestions: [], model };
  }

  const rows = normalized.map((suggestion) => ({
    meeting_id: meetingId,
    series_id: meeting.series_id,
    type: suggestion.type,
    category: suggestion.category,
    title: suggestion.title,
    details: suggestion.details,
    owner_name: suggestion.owner_name,
    due_date: suggestion.due_date,
    confidence: suggestion.confidence,
    source_excerpt: suggestion.source_excerpt,
    related_issue_number: suggestion.related_issue_number,
    suggested_status: suggestion.suggested_status,
    ai_model: model,
    ai_prompt_version: SUGGESTIONS_PROMPT_VERSION,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("meeting_ai_suggestions")
    .insert(rows)
    .select("*")
    .order("created_at", { ascending: true });
  if (insertError) {
    return { ok: false, status: 500, error: "Failed to save AI suggestions." };
  }

  return { ok: true, suggestions: inserted ?? [], model };
}
