import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { userManagesSeries } from "@/lib/series/manage-access";
import { matchSeriesMember } from "@/lib/ai/owner-match";
import { isOpenForReview } from "@/lib/ai/review-claim";

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

async function loadSeriesMembers(seriesId: string) {
  const admin = createServiceRoleClient();
  const [{ data: series }, { data: participants }] = await Promise.all([
    admin
      .from("meeting_series")
      .select("owner_id")
      .eq("id", seriesId)
      .maybeSingle(),
    admin
      .from("series_participants")
      .select("user_id")
      .eq("series_id", seriesId),
  ]);
  const ids = [
    ...new Set([
      series?.owner_id,
      ...(participants ?? []).map((p) => p.user_id),
    ]),
  ].filter((id): id is string => !!id);
  if (!ids.length) return [];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, name")
    .in("id", ids);
  return (profiles ?? []).map((p) => ({
    id: p.id as string,
    name: (p.name as string | null) ?? "",
  }));
}

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

  if (!isOpenForReview(suggestion)) {
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
    const rejectUpdate = supabase
      .from("meeting_ai_suggestions")
      .update({
        title,
        details,
        category,
        owner_name: ownerName,
        due_date: dueDate,
        status: "rejected",
        reviewing_at: null,
        reviewed_at: reviewedAt,
      })
      .eq("id", suggestionId)
      .eq("status", suggestion.status);
    const { data, error: updateError } = await (
      suggestion.reviewing_at
        ? rejectUpdate.eq("reviewing_at", suggestion.reviewing_at)
        : rejectUpdate
    )
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

  let membersLoad: ReturnType<typeof loadSeriesMembers> | undefined;
  const seriesMembers = () =>
    (membersLoad ??= loadSeriesMembers(suggestion.series_id));
  if (
    body.owner_user_id &&
    !(await seriesMembers()).some((m) => m.id === body.owner_user_id)
  ) {
    return refuse(
      400,
      "not_a_member",
      "The owner must be a member of this series.",
    );
  }

  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_ai_suggestion",
    {
      p_suggestion_id: suggestionId,
    },
  );
  if (claimError) {
    return refuse(500, "save_failed", "Failed to save AI suggestion.");
  }
  if (!claimed) {
    return refuse(
      409,
      "already_reviewed",
      "AI suggestion has already been reviewed.",
    );
  }

  const userId = user.id;
  let saved = false;
  let landed = false;
  try {
    const response = await keep();
    saved = response.ok;
    return response;
  } finally {
    if (!saved && !landed)
      await supabase.rpc("release_ai_suggestion", {
        p_suggestion_id: suggestionId,
      });
  }

  async function keep(): Promise<NextResponse> {
    // Accepting a status_update applies the change to the EXISTING OIL
    // item the suggestion references, rather than creating a parallel item. This
    // is the cross-meeting memory paying off: the meeting that resolved a prior
    // risk closes it on the board, with an AI-authored audit row to prove it.
    if (suggestion.type === "status_update") {
      const targetStatus = body.suggested_status ?? suggestion.suggested_status;
      if (suggestion.related_issue_number == null) {
        return refuse(
          400,
          "not_linked",
          "This suggestion is not linked to an existing item.",
        );
      }
      if (!targetStatus) {
        return refuse(
          400,
          "no_target_status",
          "This suggestion has no target status to apply.",
        );
      }

      const { data: existing, error: findError } = await supabase
        .from("issues")
        .select("id, status")
        .eq("series_id", suggestion.series_id)
        .eq("issue_number", suggestion.related_issue_number)
        .maybeSingle();

      if (findError) {
        return refuse(
          500,
          "save_failed",
          "Failed to look up the referenced item.",
        );
      }
      if (!existing) {
        return refuse(
          404,
          "item_gone",
          "The referenced item no longer exists.",
        );
      }

      // The item's status can change between extraction and review (someone else
      // moved it, or a partial earlier accept already applied this). Re-applying
      // the same status would write a no-op audit row and could overwrite the
      // resolution provenance, so refuse it. With this guard, resolved_in_meeting_id
      // is only ever set on a genuine transition into "resolved".
      if (existing.status === targetStatus) {
        return refuse(
          409,
          "already_in_state",
          "The referenced item is already in that status.",
        );
      }

      const { error: issueUpdateError } = await supabase
        .from("issues")
        .update({
          status: targetStatus,
          resolved_in_meeting_id:
            targetStatus === "resolved" ? meetingId : null,
        })
        .eq("id", existing.id);

      if (issueUpdateError) {
        return refuse(
          500,
          "save_failed",
          "Failed to update the referenced item.",
        );
      }
      landed = true;

      const { error: auditError } = await supabase
        .from("issue_updates")
        .insert({
          issue_id: existing.id,
          meeting_id: meetingId,
          updated_by: userId,
          author_type: "ai",
          previous_status: existing.status,
          new_status: targetStatus,
          note: details || suggestion.source_excerpt || "",
        });

      if (auditError) {
        return refuse(
          500,
          "save_failed",
          "Failed to record the status change.",
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
          reviewing_at: null,
          reviewed_at: reviewedAt,
          created_issue_id: existing.id,
        })
        .eq("id", suggestionId)
        .eq("status", "reviewing")
        .select("*")
        .single();

      if (markError) {
        return refuse(
          500,
          "save_failed",
          "Failed to mark AI suggestion accepted.",
        );
      }

      return NextResponse.json({
        suggestion: data,
        code: "saved",
        request_id: requestId,
      });
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
          created_by: userId,
        })
        .select("id")
        .single();

      if (decisionError || !decision) {
        return refuse(
          500,
          "save_failed",
          "Failed to create decision from AI suggestion.",
        );
      }
      landed = true;

      const { data, error: updateError } = await supabase
        .from("meeting_ai_suggestions")
        .update({
          title,
          details,
          category,
          owner_name: ownerName,
          due_date: dueDate,
          status: "accepted",
          reviewing_at: null,
          reviewed_at: reviewedAt,
          created_decision_id: decision.id,
        })
        .eq("id", suggestionId)
        .eq("status", "reviewing")
        .select("*")
        .single();

      if (updateError) {
        return refuse(
          500,
          "save_failed",
          "Failed to mark AI suggestion accepted.",
        );
      }

      return NextResponse.json({
        suggestion: data,
        code: "saved",
        request_id: requestId,
      });
    }

    const members = await seriesMembers();
    const ownerUserId =
      body.owner_user_id ?? matchSeriesMember(ownerName, members);
    const issueOwnerName =
      members.find((m) => m.id === ownerUserId)?.name || ownerName;

    const { data: issue, error: issueError } = await supabase
      .from("issues")
      .insert({
        series_id: suggestion.series_id,
        raised_in_meeting_id: meetingId,
        title,
        description: details || suggestion.source_excerpt || "",
        category,
        priority: "medium",
        owner_name: issueOwnerName,
        owner_user_id: ownerUserId,
        due_date: dueDate,
        status: "open",
        source: "ai_suggested",
        ai_confidence: suggestion.confidence,
      })
      .select("id")
      .single();

    if (issueError || !issue) {
      return refuse(
        500,
        "save_failed",
        "Failed to create issue from AI suggestion.",
      );
    }
    landed = true;

    const { data, error: updateError } = await supabase
      .from("meeting_ai_suggestions")
      .update({
        title,
        details,
        category,
        owner_name: ownerName,
        due_date: dueDate,
        status: "accepted",
        reviewing_at: null,
        reviewed_at: reviewedAt,
        created_issue_id: issue.id,
      })
      .eq("id", suggestionId)
      .eq("status", "reviewing")
      .select("*")
      .single();

    if (updateError) {
      return refuse(
        500,
        "save_failed",
        "Failed to mark AI suggestion accepted.",
      );
    }

    return NextResponse.json({
      suggestion: data,
      code: "saved",
      request_id: requestId,
    });
  }
}
