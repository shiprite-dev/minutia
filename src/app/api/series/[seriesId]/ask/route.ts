import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const OPENROUTER_MODEL = "minimax/minimax-m3";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PROMPT_VERSION = "ask-series-v1";
const UNSUPPORTED_ANSWER = "The source context does not prove the answer.";
const uuidLikeSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
);

const requestSchema = z.object({
  question: z.string().trim().min(1).max(1000),
});

const citationSchema = z.object({
  type: z.enum(["meeting", "issue", "decision", "notes"]),
  source_id: uuidLikeSchema,
  title: z.string().min(1).max(300),
  meeting_id: uuidLikeSchema.nullable().default(null),
  meeting_title: z.string().nullable().default(null),
});

const answerSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
  citations: z.array(citationSchema).default([]),
  unsupported: z.boolean().default(false),
});

type AskSeriesAnswer = z.infer<typeof answerSchema>;
type AskSeriesCitation = z.infer<typeof citationSchema> & {
  href: string;
  label: string;
};

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
  if (process.env.MINUTIA_TEST_SERIES_ASK_RESPONSE) {
    return {
      choices: [
        {
          message: {
            content: process.env.MINUTIA_TEST_SERIES_ASK_RESPONSE,
          },
        },
      ],
    };
  }

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

function citationHref(citation: z.infer<typeof citationSchema>) {
  if (citation.type === "issue") return `/issues/${citation.source_id}`;
  const meetingId = citation.type === "meeting" || citation.type === "notes"
    ? citation.source_id
    : citation.meeting_id;
  return meetingId ? `meetings/${meetingId}` : "";
}

function citationLabel(citation: z.infer<typeof citationSchema>) {
  const sourceLabel = citation.meeting_title || citation.title;
  return citation.type === "notes" ? `Notes: ${sourceLabel}` : sourceLabel;
}

function normalizeAnswer(input: {
  parsed: AskSeriesAnswer;
  seriesId: string;
  meetingIds: Set<string>;
  issueIds: Set<string>;
  decisionIds: Set<string>;
}) {
  const validCitations: AskSeriesCitation[] = [];

  for (const citation of input.parsed.citations) {
    const valid =
      (citation.type === "meeting" && input.meetingIds.has(citation.source_id)) ||
      (citation.type === "notes" && input.meetingIds.has(citation.source_id)) ||
      (citation.type === "issue" && input.issueIds.has(citation.source_id)) ||
      (citation.type === "decision" && input.decisionIds.has(citation.source_id));
    if (!valid) continue;

    const relativeHref = citationHref(citation);
    if (!relativeHref) continue;
    validCitations.push({
      ...citation,
      href: relativeHref.startsWith("/issues")
        ? relativeHref
        : `/series/${input.seriesId}/${relativeHref}`,
      label: citationLabel(citation),
    });
  }

  if (input.parsed.unsupported || validCitations.length === 0) {
    return {
      answer: UNSUPPORTED_ANSWER,
      citations: [],
      unsupported: true,
    };
  }

  return {
    answer: input.parsed.answer,
    citations: validCitations,
    unsupported: false,
  };
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

  const apiKey = process.env.OPENROUTER_API_KEY;
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

  let parsed: AskSeriesAnswer;
  try {
    parsed = answerSchema.parse(JSON.parse(getTextFromOpenRouter(providerData)));
  } catch {
    return NextResponse.json(
      { error: "AI provider returned an invalid answer.", request_id: requestId },
      { status: 502 }
    );
  }

  const normalized = normalizeAnswer({
    parsed,
    seriesId,
    meetingIds: new Set((meetings ?? []).map((meeting) => meeting.id)),
    issueIds: new Set((issues ?? []).map((issue) => issue.id)),
    decisionIds: new Set((decisions ?? []).map((decision) => decision.id)),
  });

  return NextResponse.json({
    ...normalized,
    model: OPENROUTER_MODEL,
    prompt_version: PROMPT_VERSION,
    request_id: requestId,
  });
}
