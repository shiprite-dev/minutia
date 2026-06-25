import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOpenRouterApiKey } from "@/lib/ai/openrouter";
import { requireAiAccess } from "@/lib/ai/access";
import { generateMeetingSuggestions } from "@/lib/ai/suggestions";
import { userManagesSeries } from "@/lib/series/manage-access";

const requestSchema = z.object({
  mode: z.enum(["generate"]).default("generate"),
});

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

  // Enforces authentication; also requires has_full_access when feature gating
  // is on (NEXT_PUBLIC_FEATURE_GATING=true).
  const aiDenied = await requireAiAccess();
  if (aiDenied) {
    return NextResponse.json(
      { error: (await aiDenied.json()).error, request_id: requestId },
      { status: aiDenied.status }
    );
  }

  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI suggestions are not configured.", request_id: requestId },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("series_id")
    .eq("id", meetingId)
    .single();
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found", request_id: requestId }, { status: 404 });
  }
  // Generation deletes and replaces pending suggestions and spends an AI call,
  // so restrict it to those who manage the series (mirrors the accept route).
  if (!user || !(await userManagesSeries(meeting.series_id, user.id))) {
    return NextResponse.json(
      { error: "Only series owners and facilitators can generate AI suggestions.", request_id: requestId },
      { status: 403 }
    );
  }

  // MIN-121: context-aware extraction lives in the shared generator so the
  // transcribe pipeline can reuse it. The series history is what lets the model
  // deduplicate, detect resolutions, and flag contradictions.
  const outcome = await generateMeetingSuggestions(supabase, meetingId, apiKey);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, request_id: requestId }, { status: outcome.status });
  }

  return NextResponse.json({ suggestions: outcome.suggestions, request_id: requestId });
}
