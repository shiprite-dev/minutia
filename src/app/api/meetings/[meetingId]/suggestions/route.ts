import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTextFromOpenRouter } from "@/lib/ai/ask-series-answer";
import { callOpenRouter, getOpenRouterApiKey } from "@/lib/ai/openrouter";

const PROMPT_VERSION = "ai-suggestions-v1";
const SYSTEM_PROMPT = "You extract accountable meeting follow-ups. Return valid JSON only.";

const requestSchema = z.object({
  mode: z.enum(["generate"]).default("generate"),
});

const suggestionSchema = z.object({
  category: z.enum(["action", "decision", "info", "risk", "blocker"]),
  title: z.string().min(1).max(500),
  details: z.string().default(""),
  owner_name: z.string().default(""),
  due_date: z.iso.date().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  source_excerpt: z.string().default(""),
});

const suggestionsSchema = z.object({
  suggestions: z.array(suggestionSchema).default([]),
});

function buildPrompt(input: {
  title: string;
  seriesName: string;
  attendees: string[];
  notes: string;
  transcript: string | null;
}) {
  return [
    "You extract reviewable accountability suggestions for Minutia, an Outstanding Issues Log.",
    "A facilitator reviews every suggestion before it enters a permanent record, so omitting a weak item is always better than inventing one.",
    "",
    "OUTPUT CONTRACT",
    'Return only a single JSON object of the form {"suggestions": [ ... ]}.',
    "Do not wrap it in markdown fences. Do not add commentary, explanations, or text before or after the JSON.",
    "If nothing in the notes or transcript qualifies, return {\"suggestions\": []}.",
    "",
    "Each suggestion object must have exactly these fields:",
    "- category: one of action, decision, info, risk, blocker.",
    "    action = a task someone must do. decision = a choice that was made.",
    "    risk = a possible future problem. blocker = something currently preventing progress. info = a durable fact worth tracking.",
    "- title: concise imperative summary, max 120 characters, no trailing punctuation.",
    "- details: one or two sentences of supporting context, or \"\" if none.",
    "- owner_name: copy a person's name verbatim only if the source explicitly assigns them. Never guess. Use \"\" when unassigned.",
    "- due_date: an explicit calendar date as YYYY-MM-DD, only if the source states one. Never infer from relative phrasing. Use null otherwise.",
    "- confidence: 0 to 1. Use 0.9+ when explicitly stated and owned, 0.5 to 0.8 when implied, and omit any item you would score below 0.4.",
    "- source_excerpt: a verbatim quote copied from the notes or transcript that supports this item. Do not paraphrase. Keep it under 160 characters.",
    "",
    "RULES",
    "Only surface durable items a facilitator should track. Skip greetings, small talk, and resolved chatter.",
    "Emit at most one suggestion per distinct item; do not duplicate.",
    "Prefer fewer, high-signal suggestions over many speculative ones.",
    "",
    `Series: ${input.seriesName}`,
    `Meeting: ${input.title}`,
    `Attendees: ${input.attendees.join(", ") || "Unknown"}`,
    "",
    "Raw notes:",
    input.notes || "(empty)",
    "",
    "Transcript:",
    input.transcript || "(not provided)",
  ].join("\n");
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { meetingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated", request_id: requestId }, { status: 401 });
  }

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("id")
    .eq("id", meetingId)
    .single();
  if (meetingError || !meeting) {
    return NextResponse.json({ error: "Meeting not found", request_id: requestId }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("meeting_ai_suggestions")
    .select("*")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "Failed to load AI suggestions.", request_id: requestId }, { status: 500 });
  }

  return NextResponse.json({ suggestions: data ?? [], request_id: requestId });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { meetingId } = await params;

  try {
    requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body", request_id: requestId }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated", request_id: requestId }, { status: 401 });
  }

  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI suggestions are not configured.", request_id: requestId },
      { status: 503 }
    );
  }

  const { data: meeting, error } = await supabase
    .from("meetings")
    .select("*, series:meeting_series!inner(name)")
    .eq("id", meetingId)
    .single();

  if (error || !meeting) {
    return NextResponse.json({ error: "Meeting not found", request_id: requestId }, { status: 404 });
  }

  const rawNotes = meeting.raw_notes_markdown || meeting.notes_markdown || "";
  if (!rawNotes.trim() && !meeting.transcript_raw?.trim()) {
    return NextResponse.json(
      { error: "Add notes or a transcript before extracting suggestions.", request_id: requestId },
      { status: 400 }
    );
  }

  const prompt = buildPrompt({
    title: meeting.title,
    seriesName: meeting.series?.name ?? "Untitled series",
    attendees: meeting.attendees ?? [],
    notes: rawNotes,
    transcript: meeting.transcript_raw,
  });

  let providerData: unknown;
  let model: string;
  try {
    ({ data: providerData, model } = await callOpenRouter({ apiKey, system: SYSTEM_PROMPT, prompt }));
  } catch {
    return NextResponse.json(
      { error: "AI provider request failed.", request_id: requestId },
      { status: 502 }
    );
  }

  let parsed: z.infer<typeof suggestionsSchema>;
  try {
    parsed = suggestionsSchema.parse(JSON.parse(getTextFromOpenRouter(providerData)));
  } catch {
    return NextResponse.json(
      { error: "AI provider returned invalid suggestions.", request_id: requestId },
      { status: 502 }
    );
  }

  const { error: deleteError } = await supabase
    .from("meeting_ai_suggestions")
    .delete()
    .eq("meeting_id", meetingId)
    .eq("status", "pending");
  if (deleteError) {
    return NextResponse.json(
      { error: "Failed to refresh AI suggestions.", request_id: requestId },
      { status: 500 }
    );
  }

  if (parsed.suggestions.length === 0) {
    return NextResponse.json({ suggestions: [], request_id: requestId });
  }

  const rows = parsed.suggestions.map((suggestion) => ({
    meeting_id: meetingId,
    series_id: meeting.series_id,
    category: suggestion.category,
    title: suggestion.title,
    details: suggestion.details,
    owner_name: suggestion.owner_name,
    due_date: suggestion.due_date,
    confidence: suggestion.confidence,
    source_excerpt: suggestion.source_excerpt,
    ai_model: model,
    ai_prompt_version: PROMPT_VERSION,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("meeting_ai_suggestions")
    .insert(rows)
    .select("*")
    .order("created_at", { ascending: true });
  if (insertError) {
    return NextResponse.json(
      { error: "Failed to save AI suggestions.", request_id: requestId },
      { status: 500 }
    );
  }

  return NextResponse.json({ suggestions: inserted ?? [], request_id: requestId });
}
