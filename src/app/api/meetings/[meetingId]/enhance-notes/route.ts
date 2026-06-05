import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const OPENROUTER_MODEL = "minimax/minimax-m3";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PROMPT_VERSION = "ai-notes-v1";

const requestSchema = z.object({
  mode: z.enum(["preview"]).default("preview"),
});

const notesSchema = z.object({
  summary: z.array(z.string()).default([]),
  action_items: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  follow_ups: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
});

type AiNotes = z.infer<typeof notesSchema>;

function section(title: string, items: string[]) {
  if (items.length === 0) return "";
  return [`## ${title}`, ...items.map((item) => `- ${item}`)].join("\n");
}

function toMarkdown(notes: AiNotes) {
  return [
    section("Summary", notes.summary),
    section("Action Items", notes.action_items),
    section("Decisions", notes.decisions),
    section("Risks", notes.risks),
    section("Blockers", notes.blockers),
    section("Follow-ups", notes.follow_ups),
    section("Open Questions", notes.open_questions),
  ].filter(Boolean).join("\n\n");
}

function buildPrompt(input: {
  title: string;
  seriesName: string;
  attendees: string[];
  notes: string;
  transcript: string | null;
  issues: { title: string; status: string; owner_name: string | null; category: string }[];
  decisions: { title: string; rationale: string | null }[];
}) {
  return [
    "You enhance recurring meeting notes for Minutia, an Outstanding Issues Log.",
    "Return strict JSON with these array fields: summary, action_items, decisions, risks, blockers, follow_ups, open_questions.",
    "Do not invent owners, dates, or decisions. If uncertain, put the uncertainty in open_questions.",
    "Prefer concise, accountable wording.",
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
    "",
    "Existing open context:",
    JSON.stringify({ issues: input.issues, decisions: input.decisions }, null, 2),
  ].join("\n");
}

function getTextFromOpenRouter(data: unknown) {
  const content = (data as any)?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part?.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
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
        { role: "system", content: "You are a precise meeting-notes editor. Return valid JSON only." },
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { meetingId } = await params;

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body", request_id: requestId }, { status: 400 });
  }

  void body;

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI notes are not configured.", request_id: requestId },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated", request_id: requestId }, { status: 401 });
  }

  const { data: meeting, error } = await supabase
    .from("meetings")
    .select("*, series:meeting_series!inner(name), issues:issues!raised_in_meeting_id(title,status,owner_name,category), decisions(title,rationale)")
    .eq("id", meetingId)
    .single();

  if (error || !meeting) {
    return NextResponse.json({ error: "Meeting not found", request_id: requestId }, { status: 404 });
  }

  const rawNotes = meeting.raw_notes_markdown || meeting.notes_markdown || "";
  if (!rawNotes.trim() && !meeting.transcript_raw?.trim()) {
    return NextResponse.json(
      { error: "Add notes or a transcript before enhancing.", request_id: requestId },
      { status: 400 }
    );
  }

  const prompt = buildPrompt({
    title: meeting.title,
    seriesName: meeting.series?.name ?? "Untitled series",
    attendees: meeting.attendees ?? [],
    notes: rawNotes,
    transcript: meeting.transcript_raw,
    issues: meeting.issues ?? [],
    decisions: meeting.decisions ?? [],
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

  let parsed: AiNotes;
  try {
    const text = getTextFromOpenRouter(providerData);
    parsed = notesSchema.parse(JSON.parse(text));
  } catch {
    return NextResponse.json(
      { error: "AI provider returned invalid notes.", request_id: requestId },
      { status: 502 }
    );
  }

  const aiNotes = toMarkdown(parsed);
  const generatedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("meetings")
    .update({
      raw_notes_markdown: rawNotes,
      ai_notes_markdown: aiNotes,
      ai_notes_generated_at: generatedAt,
      ai_notes_model: OPENROUTER_MODEL,
      ai_notes_prompt_version: PROMPT_VERSION,
    })
    .eq("id", meetingId);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to save AI notes.", request_id: requestId },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ai_notes: parsed,
    ai_notes_markdown: aiNotes,
    model: OPENROUTER_MODEL,
    prompt_version: PROMPT_VERSION,
    generated_at: generatedAt,
    request_id: requestId,
  });
}
