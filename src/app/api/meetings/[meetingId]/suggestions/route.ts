import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const OPENROUTER_MODEL = "minimax/minimax-m3";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PROMPT_VERSION = "ai-suggestions-v1";

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

function getTextFromOpenRouter(data: unknown) {
  const parsed = z
    .object({
      choices: z.array(
        z.object({
          message: z.object({
            content: z.union([
              z.string(),
              z.array(z.object({ text: z.string().optional() }).passthrough()),
            ]),
          }),
        }).passthrough()
      ).min(1),
    })
    .passthrough()
    .safeParse(data);

  if (!parsed.success) return "";
  const content = parsed.data.choices[0].message.content;
  if (typeof content === "string") return content;
  return content.map((part) => part.text ?? "").filter(Boolean).join("\n");
}

function buildPrompt(input: {
  title: string;
  seriesName: string;
  attendees: string[];
  notes: string;
  transcript: string | null;
}) {
  return [
    "Extract reviewable accountability suggestions for Minutia, an Outstanding Issues Log.",
    "Return strict JSON with a suggestions array.",
    "Each suggestion must include category, title, details, owner_name, due_date, confidence, and source_excerpt.",
    "Allowed categories: action, decision, info, risk, blocker.",
    "Only suggest durable records that a facilitator should review. Do not invent owners or due dates.",
    "Use source_excerpt to quote the smallest supporting phrase from the notes or transcript.",
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

async function getOpenRouterData(prompt: string, apiKey: string) {
  const providerResponse = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.SITE_URL ?? "https://example.com",
      "X-OpenRouter-Title": "Minutia",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "system",
          content: "You extract accountable meeting follow-ups. Return valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!providerResponse.ok) {
    throw new Error("Provider request failed");
  }

  return providerResponse.json();
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

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY;
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
  try {
    providerData = await getOpenRouterData(prompt, apiKey);
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
    ai_model: OPENROUTER_MODEL,
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
