import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { userManagesSeries } from "@/lib/series/manage-access";
import type { GenerateOutcome } from "./suggestions";

export type SuggestionsFinalStatus = {
  status: "ready" | "failed" | "skipped";
  reason: string | null;
};

export function suggestionsStatusFor(
  outcome: GenerateOutcome,
): SuggestionsFinalStatus {
  if (outcome.ok) return { status: "ready", reason: null };
  if (outcome.code === "skipped_no_content")
    return { status: "skipped", reason: "no_content" };
  if (outcome.code === "skipped_unconfigured")
    return { status: "skipped", reason: "not_configured" };
  return { status: "failed", reason: outcome.code };
}

async function write(meetingId: string, status: string, reason: string | null) {
  try {
    const { error } = await createServiceRoleClient()
      .from("meetings")
      .update({
        suggestions_status: status,
        suggestions_reason: reason,
        suggestions_status_at: new Date().toISOString(),
      })
      .eq("id", meetingId);
    if (error) throw error;
  } catch (err) {
    console.error("[suggestions-status] could not record status", {
      meetingId,
      status,
      error: (err as { message?: string })?.message ?? String(err),
    });
  }
}

export function markSuggestionsPending(meetingId: string) {
  return write(meetingId, "pending", null);
}

export function recordSuggestionsStatus(
  meetingId: string,
  s: SuggestionsFinalStatus,
) {
  return write(meetingId, s.status, s.reason);
}

/** Records a plan skip only for someone who manages the meeting's series, so a denied caller cannot write to meetings they do not run. */
export async function recordNotOnPlan(meetingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: meeting } = await supabase
    .from("meetings")
    .select("series_id")
    .eq("id", meetingId)
    .single();
  if (!meeting || !(await userManagesSeries(meeting.series_id, user.id)))
    return;
  await write(meetingId, "skipped", "not_on_plan");
}
