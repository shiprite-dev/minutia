import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userManagesSeries } from "@/lib/series/manage-access";
import { matchSeriesMember } from "@/lib/ai/owner-match";
import { loadSeriesMembers } from "@/lib/series/members";

const reviewSchema = z.object({
  action: z.enum(["accept", "reject"]),
  title: z.string().min(1).max(500).optional(),
  details: z.string().optional(),
  category: z
    .enum(["action", "decision", "info", "risk", "blocker"])
    .optional(),
  owner_name: z.string().optional(),
  due_date: z.iso.date().nullable().optional(),
  // A status_update can be retargeted at review time.
  suggested_status: z
    .enum(["open", "in_progress", "pending", "resolved", "dropped"])
    .nullable()
    .optional(),
  owner_user_id: z.guid().optional(),
});

const KEEP_REFUSALS: Record<string, [number, string]> = {
  suggestion_gone: [404, "AI suggestion not found"],
  already_reviewed: [409, "AI suggestion has already been reviewed."],
  not_reviewer: [
    403,
    "Only series owners and facilitators can review AI suggestions.",
  ],
  cannot_keep_duplicate: [
    400,
    "A duplicate warning can't be accepted. Dismiss it or open the existing item.",
  ],
  not_linked: [400, "This suggestion is not linked to an existing item."],
  no_target_status: [400, "This suggestion has no target status to apply."],
  item_gone: [404, "The referenced item no longer exists."],
  already_in_state: [409, "The referenced item is already in that status."],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string; suggestionId: string }> },
) {
  const requestId = crypto.randomUUID();
  const { meetingId, suggestionId } = await params;
  const refuse = (status: number, code: string, error: string) =>
    NextResponse.json({ error, code, request_id: requestId }, { status });

  let body: z.infer<typeof reviewSchema>;
  try {
    body = reviewSchema.parse(await request.json());
  } catch {
    return refuse(400, "invalid_request", "Invalid request body");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return refuse(401, "not_signed_in", "Not authenticated");
  }

  const { data: suggestion, error } = await supabase
    .from("meeting_ai_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .eq("meeting_id", meetingId)
    .single();

  if (error || !suggestion) {
    return refuse(404, "suggestion_gone", "AI suggestion not found");
  }

  // Accepting a suggestion mutates the OIL (creates an issue/decision, or moves
  // an existing item), so restrict review to those who manage the series.
  if (!(await userManagesSeries(suggestion.series_id, user.id))) {
    return refuse(
      403,
      "not_reviewer",
      "Only series owners and facilitators can review AI suggestions.",
    );
  }

  if (suggestion.status !== "pending") {
    return refuse(
      409,
      "already_reviewed",
      "AI suggestion has already been reviewed.",
    );
  }

  const reviewedAt = new Date().toISOString();
  const title = body.title ?? suggestion.title;
  const details = body.details ?? suggestion.details ?? "";
  const category = body.category ?? suggestion.category;
  const ownerName = body.owner_name ?? suggestion.owner_name ?? "";
  const dueDate =
    body.due_date === undefined ? (suggestion.due_date ?? null) : body.due_date;

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
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (updateError) {
      return refuse(500, "save_failed", "Failed to reject AI suggestion.");
    }
    if (!data) {
      return refuse(
        409,
        "already_reviewed",
        "AI suggestion has already been reviewed.",
      );
    }

    return NextResponse.json({
      suggestion: data,
      code: "saved",
      request_id: requestId,
    });
  }

  // A duplicate warning is informational: accepting it would create the very
  // duplicate it flags. The reviewer dismisses it (reject) or opens the
  // existing item instead.
  if (suggestion.type === "duplicate_warning") {
    return refuse(
      400,
      "cannot_keep_duplicate",
      "A duplicate warning can't be accepted. Dismiss it or open the existing item.",
    );
  }

  const createsIssue =
    suggestion.type !== "status_update" && category !== "decision";
  const members =
    body.owner_user_id || createsIssue
      ? await loadSeriesMembers(suggestion.series_id)
      : [];
  if (body.owner_user_id && !members.some((m) => m.id === body.owner_user_id)) {
    return refuse(
      400,
      "not_a_member",
      "The owner must be a member of this series.",
    );
  }

  const ownerUserId = createsIssue
    ? (body.owner_user_id ?? matchSeriesMember(ownerName, members))
    : null;
  const issueOwnerName =
    members.find((m) => m.id === ownerUserId)?.name || ownerName;

  const { data: kept, error: keepError } = await supabase.rpc(
    "keep_ai_suggestion",
    {
      p_suggestion_id: suggestionId,
      p_meeting_id: meetingId,
      p_title: title,
      p_details: details,
      p_category: category,
      p_owner_name: ownerName,
      p_issue_owner_name: issueOwnerName,
      p_owner_user_id: ownerUserId,
      p_due_date: dueDate,
      p_target_status: body.suggested_status ?? null,
    },
  );
  if (keepError || !kept) {
    return refuse(500, "save_failed", "Failed to save AI suggestion.");
  }

  const { code, suggestion: saved } = kept as {
    code: string;
    suggestion?: unknown;
  };
  if (code === "saved") {
    return NextResponse.json({
      suggestion: saved,
      code,
      request_id: requestId,
    });
  }
  const refusal = KEEP_REFUSALS[code];
  return refusal
    ? refuse(refusal[0], code, refusal[1])
    : refuse(500, "save_failed", "Failed to save AI suggestion.");
}
