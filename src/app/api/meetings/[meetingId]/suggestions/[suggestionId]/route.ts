import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const reviewSchema = z.object({
  action: z.enum(["accept", "reject"]),
  title: z.string().min(1).max(500).optional(),
  details: z.string().optional(),
  category: z.enum(["action", "decision", "info", "risk", "blocker"]).optional(),
  owner_name: z.string().optional(),
  due_date: z.iso.date().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string; suggestionId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { meetingId, suggestionId } = await params;

  let body: z.infer<typeof reviewSchema>;
  try {
    body = reviewSchema.parse(await request.json());
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

  const { data: suggestion, error } = await supabase
    .from("meeting_ai_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .eq("meeting_id", meetingId)
    .single();

  if (error || !suggestion) {
    return NextResponse.json({ error: "AI suggestion not found", request_id: requestId }, { status: 404 });
  }

  if (suggestion.status !== "pending") {
    return NextResponse.json(
      { error: "AI suggestion has already been reviewed.", request_id: requestId },
      { status: 409 }
    );
  }

  const reviewedAt = new Date().toISOString();
  const title = body.title ?? suggestion.title;
  const details = body.details ?? suggestion.details ?? "";
  const category = body.category ?? suggestion.category;
  const ownerName = body.owner_name ?? suggestion.owner_name ?? "";
  const dueDate = body.due_date === undefined ? suggestion.due_date ?? null : body.due_date;

  if (body.action === "reject") {
    const { data, error: updateError } = await supabase
      .from("meeting_ai_suggestions")
      .update({
        title,
        details,
        category,
        owner_name: ownerName,
        due_date: dueDate,
        status: "rejected",
        reviewed_at: reviewedAt,
      })
      .eq("id", suggestionId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to reject AI suggestion.", request_id: requestId },
        { status: 500 }
      );
    }

    return NextResponse.json({ suggestion: data, request_id: requestId });
  }

  if (category === "decision") {
    const { data: decision, error: decisionError } = await supabase
      .from("decisions")
      .insert({
        meeting_id: meetingId,
        series_id: suggestion.series_id,
        title,
        rationale: details || suggestion.source_excerpt || "",
        made_by: ownerName,
        source: "ai_suggested",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (decisionError || !decision) {
      return NextResponse.json(
        { error: "Failed to create decision from AI suggestion.", request_id: requestId },
        { status: 500 }
      );
    }

    const { data, error: updateError } = await supabase
      .from("meeting_ai_suggestions")
      .update({
        title,
        details,
        category,
        owner_name: ownerName,
        due_date: dueDate,
        status: "accepted",
        reviewed_at: reviewedAt,
        created_decision_id: decision.id,
      })
      .eq("id", suggestionId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to mark AI suggestion accepted.", request_id: requestId },
        { status: 500 }
      );
    }

    return NextResponse.json({ suggestion: data, request_id: requestId });
  }

  const { data: issue, error: issueError } = await supabase
    .from("issues")
    .insert({
      series_id: suggestion.series_id,
      raised_in_meeting_id: meetingId,
      title,
      description: details || suggestion.source_excerpt || "",
      category,
      priority: "medium",
      owner_name: ownerName,
      owner_user_id: null,
      due_date: dueDate,
      status: "open",
      source: "ai_suggested",
      ai_confidence: suggestion.confidence,
    })
    .select("id")
    .single();

  if (issueError || !issue) {
    return NextResponse.json(
      { error: "Failed to create issue from AI suggestion.", request_id: requestId },
      { status: 500 }
    );
  }

  const { data, error: updateError } = await supabase
    .from("meeting_ai_suggestions")
    .update({
      title,
      details,
      category,
      owner_name: ownerName,
      due_date: dueDate,
      status: "accepted",
      reviewed_at: reviewedAt,
      created_issue_id: issue.id,
    })
    .eq("id", suggestionId)
    .select("*")
    .single();

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to mark AI suggestion accepted.", request_id: requestId },
      { status: 500 }
    );
  }

  return NextResponse.json({ suggestion: data, request_id: requestId });
}
