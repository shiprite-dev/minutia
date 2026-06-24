import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callOpenRouter, getOpenRouterApiKey } from "@/lib/ai/openrouter";
import { requireAiAccess } from "@/lib/ai/access";
import {
  summarizeCarryover,
  parseCarryoverBriefing,
  type CarryoverIssue,
  type CarryoverSummary,
} from "@/lib/ai/carryover";

const PROMPT_VERSION = "carryover-briefing-v1";
const SYSTEM_PROMPT = "You write concise pre-meeting carry-over briefings. Return valid JSON only.";

function buildPrompt(input: {
  seriesName: string;
  meetingTitle: string;
  summary: CarryoverSummary;
}) {
  const items = input.summary.issues.slice(0, 12).map((issue) => ({
    issue: issue.issue_number,
    title: issue.title,
    category: issue.category,
    status: issue.status,
    owner: issue.owner_name ?? null,
    due_date: issue.due_date,
    overdue: issue.overdue,
    days_open: issue.days_open,
  }));

  return [
    "Write a pre-meeting carry-over briefing for a Minutia recurring meeting series.",
    "A facilitator reads this to know what slipped before the meeting starts.",
    "",
    "OUTPUT CONTRACT",
    'Return only a single JSON object: {"briefing_markdown": "...", "overdue_count": N, "no_owner_count": N}.',
    "Do not wrap it in markdown fences. Do not add any text before or after the JSON.",
    "",
    "briefing_markdown rules:",
    "- 3 to 6 sentences of concise markdown.",
    "- Lead with the count of open items and how many are overdue.",
    "- Name up to 5 highest-priority items with their owner and due date.",
    "- Call out items with no owner explicitly.",
    "- Flag items open a long time as stale.",
    "Do not invent owners, dates, or resolutions. Use only the data provided.",
    "",
    `Series: ${input.seriesName}`,
    `Upcoming meeting: ${input.meetingTitle}`,
    `Totals: ${input.summary.total} open, ${input.summary.overdue_count} overdue, ${input.summary.no_owner_count} without an owner, ${input.summary.stale_count} stale.`,
    "",
    "Open issues (already ranked, overdue first):",
    JSON.stringify(items),
  ].join("\n");
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { meetingId } = await params;

  const aiDenied = await requireAiAccess();
  if (aiDenied) {
    return NextResponse.json(
      { error: (await aiDenied.json()).error, request_id: requestId },
      { status: aiDenied.status }
    );
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
      { error: "Carry-over briefing is not configured.", request_id: requestId },
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

  const { data: issues, error: issuesError } = await supabase
    .from("issues")
    .select("issue_number,title,category,status,priority,owner_name,due_date,created_at")
    .eq("series_id", meeting.series_id)
    .not("status", "in", "(resolved,dropped)")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(30);
  if (issuesError) {
    return NextResponse.json(
      { error: "Failed to load carry-over issues.", request_id: requestId },
      { status: 500 }
    );
  }

  const summary = summarizeCarryover((issues ?? []) as CarryoverIssue[], new Date());

  // Nothing open means nothing to brief: skip the provider call entirely.
  if (summary.total === 0) {
    return NextResponse.json({
      briefing_markdown: "",
      overdue_count: 0,
      no_owner_count: 0,
      issues_count: 0,
      model: null,
      prompt_version: PROMPT_VERSION,
      request_id: requestId,
    });
  }

  const prompt = buildPrompt({
    seriesName: meeting.series?.name ?? "Untitled series",
    meetingTitle: meeting.title,
    summary,
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

  let parsed;
  try {
    parsed = parseCarryoverBriefing(providerData);
  } catch {
    return NextResponse.json(
      { error: "AI provider returned an invalid briefing.", request_id: requestId },
      { status: 502 }
    );
  }

  // Counts come from our deterministic summary, not the model's claims.
  return NextResponse.json({
    briefing_markdown: parsed.briefing_markdown,
    overdue_count: summary.overdue_count,
    no_owner_count: summary.no_owner_count,
    issues_count: summary.total,
    model,
    prompt_version: PROMPT_VERSION,
    request_id: requestId,
  });
}
