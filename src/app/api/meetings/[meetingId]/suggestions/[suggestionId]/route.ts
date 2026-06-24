import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userManagesSeries } from "@/lib/series/manage-access";

const reviewSchema = z.object({
  action: z.enum(["accept", "reject"]),
  title: z.string().min(1).max(500).optional(),
  details: z.string().optional(),
  category: z.enum(["action", "decision", "info", "risk", "blocker"]).optional(),
  owner_name: z.string().optional(),
  due_date: z.iso.date().nullable().optional(),
  // MIN-121: a status_update can be retargeted at review time.
  suggested_status: z
    .enum(["open", "in_progress", "pending", "resolved", "dropped"])
    .nullable()
    .optional(),
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

  // Accepting a suggestion mutates the OIL (creates an issue/decision, or moves
  // an existing item), so restrict review to those who manage the series.
  if (!(await userManagesSeries(suggestion.series_id, user.id))) {
    return NextResponse.json(
      { error: "Only series owners and facilitators can review AI suggestions.", request_id: requestId },
      { status: 403 }
    );
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

  // MIN-121: accepting a status_update applies the change to the EXISTING OIL
  // item the suggestion references, rather than creating a parallel item. This
  // is the cross-meeting memory paying off: the meeting that resolved a prior
  // risk closes it on the board, with an AI-authored audit row to prove it.
  if (suggestion.type === "status_update") {
    const targetStatus = body.suggested_status ?? suggestion.suggested_status;
    if (suggestion.related_issue_number == null) {
      return NextResponse.json(
        { error: "This suggestion is not linked to an existing item.", request_id: requestId },
        { status: 400 }
      );
    }
    if (!targetStatus) {
      return NextResponse.json(
        { error: "This suggestion has no target status to apply.", request_id: requestId },
        { status: 400 }
      );
    }

    const { data: existing, error: findError } = await supabase
      .from("issues")
      .select("id, status")
      .eq("series_id", suggestion.series_id)
      .eq("issue_number", suggestion.related_issue_number)
      .maybeSingle();

    if (findError) {
      return NextResponse.json(
        { error: "Failed to look up the referenced item.", request_id: requestId },
        { status: 500 }
      );
    }
    if (!existing) {
      return NextResponse.json(
        { error: "The referenced item no longer exists.", request_id: requestId },
        { status: 404 }
      );
    }

    // The item's status can change between extraction and review (someone else
    // moved it, or a partial earlier accept already applied this). Re-applying
    // the same status would write a no-op audit row and could overwrite the
    // resolution provenance, so refuse it. With this guard, resolved_in_meeting_id
    // is only ever set on a genuine transition into "resolved".
    if (existing.status === targetStatus) {
      return NextResponse.json(
        { error: "The referenced item is already in that status.", request_id: requestId },
        { status: 409 }
      );
    }

    const { error: issueUpdateError } = await supabase
      .from("issues")
      .update({
        status: targetStatus,
        resolved_in_meeting_id: targetStatus === "resolved" ? meetingId : null,
      })
      .eq("id", existing.id);

    if (issueUpdateError) {
      return NextResponse.json(
        { error: "Failed to update the referenced item.", request_id: requestId },
        { status: 500 }
      );
    }

    const { error: auditError } = await supabase.from("issue_updates").insert({
      issue_id: existing.id,
      meeting_id: meetingId,
      updated_by: user.id,
      author_type: "ai",
      previous_status: existing.status,
      new_status: targetStatus,
      note: details || suggestion.source_excerpt || "",
    });

    if (auditError) {
      return NextResponse.json(
        { error: "Failed to record the status change.", request_id: requestId },
        { status: 500 }
      );
    }

    const { data, error: markError } = await supabase
      .from("meeting_ai_suggestions")
      .update({
        title,
        details,
        category,
        owner_name: ownerName,
        due_date: dueDate,
        suggested_status: targetStatus,
        status: "accepted",
        reviewed_at: reviewedAt,
        created_issue_id: existing.id,
      })
      .eq("id", suggestionId)
      .select("*")
      .single();

    if (markError) {
      return NextResponse.json(
        { error: "Failed to mark AI suggestion accepted.", request_id: requestId },
        { status: 500 }
      );
    }

    return NextResponse.json({ suggestion: data, request_id: requestId });
  }

  // A duplicate warning is informational: accepting it would create the very
  // duplicate it flags. The reviewer dismisses it (reject) or opens the
  // existing item instead.
  if (suggestion.type === "duplicate_warning") {
    return NextResponse.json(
      {
        error: "A duplicate warning can't be accepted. Dismiss it or open the existing item.",
        request_id: requestId,
      },
      { status: 400 }
    );
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
