import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseAskSeriesAnswer } from "@/lib/ai/ask-series-answer";
import { createClient } from "@/lib/supabase/server";

const OPENROUTER_MODEL = "minimax/minimax-m3";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PROMPT_VERSION = "ask-series-v1";

const requestSchema = z.object({
  question: z.string().trim().min(1).max(1000),
});

function buildPrompt(input: {
  question: string;
  series: { id: string; name: string; description: string | null };
  meetings: Array<{
    id: string;
    title: string;
    date: string;
    status: string;
    notes_markdown: string | null;
    raw_notes_markdown: string | null;
    ai_notes_markdown: string | null;
  }>;
  issues: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    category: string;
    owner_name: string | null;
    due_date: string | null;
    raised_in_meeting_id: string;
  }>;
  decisions: Array<{
    id: string;
    title: string;
    rationale: string | null;
    made_by: string | null;
    meeting_id: string;
  }>;
}) {
  return [
    "Answer questions about one Minutia recurring meeting series.",
    "Return strict JSON with answer, citations, and unsupported.",
    "Citations must reference only source ids present in the provided context.",
    "If the context does not prove the answer, set unsupported true, answer exactly: The source context does not prove the answer., and return no citations.",
    "Keep answers concise and accountability-focused.",
    "",
    `Question: ${input.question}`,
    "",
    "Series:",
    JSON.stringify(input.series, null, 2),
    "",
    "Meetings:",
    JSON.stringify(input.meetings, null, 2),
    "",
    "Issues:",
    JSON.stringify(input.issues, null, 2),
    "",
    "Decisions:",
    JSON.stringify(input.decisions, null, 2),
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
          content: "You answer from cited meeting memory only. Return valid JSON only.",
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ seriesId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { seriesId } = await params;

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
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
      { error: "Ask this series is not configured.", request_id: requestId },
      { status: 503 }
    );
  }

  const { data: series, error: seriesError } = await supabase
    .from("meeting_series")
    .select("id,name,description")
    .eq("id", seriesId)
    .single();
  if (seriesError || !series) {
    return NextResponse.json({ error: "Series not found", request_id: requestId }, { status: 404 });
  }

  const [{ data: meetings, error: meetingsError }, { data: issues, error: issuesError }, { data: decisions, error: decisionsError }] =
    await Promise.all([
      supabase
        .from("meetings")
        .select("id,title,date,status,notes_markdown,raw_notes_markdown,ai_notes_markdown")
        .eq("series_id", seriesId)
        .order("date", { ascending: false })
        .limit(40),
      supabase
        .from("issues")
        .select("id,title,description,status,category,owner_name,due_date,raised_in_meeting_id")
        .eq("series_id", seriesId)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("decisions")
        .select("id,title,rationale,made_by,meeting_id")
        .eq("series_id", seriesId)
        .order("created_at", { ascending: false })
        .limit(80),
    ]);

  if (meetingsError || issuesError || decisionsError) {
    return NextResponse.json(
      { error: "Failed to load series context.", request_id: requestId },
      { status: 500 }
    );
  }

  const prompt = buildPrompt({
    question: body.question,
    series,
    meetings: meetings ?? [],
    issues: issues ?? [],
    decisions: decisions ?? [],
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

  let normalized;
  try {
    normalized = parseAskSeriesAnswer({
      providerData,
      seriesId,
      meetings: (meetings ?? []).map((meeting) => ({
        id: meeting.id,
        title: meeting.title,
      })),
      issues: (issues ?? []).map((issue) => ({
        id: issue.id,
        title: issue.title,
        meeting_id: issue.raised_in_meeting_id,
      })),
      decisions: (decisions ?? []).map((decision) => ({
        id: decision.id,
        title: decision.title,
        meeting_id: decision.meeting_id,
      })),
    });
  } catch {
    return NextResponse.json(
      { error: "AI provider returned an invalid answer.", request_id: requestId },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ...normalized,
    model: OPENROUTER_MODEL,
    prompt_version: PROMPT_VERSION,
    request_id: requestId,
  });
}
