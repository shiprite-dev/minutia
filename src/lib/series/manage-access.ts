import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * True when the user owns or facilitates the series. Privileged OIL writes
 * (generating AI suggestions, accepting one into tracked work, applying a
 * status_update to an existing item) are gated on this so only the people who
 * run the meeting shape the board, mirroring the reminders route and the UI's
 * canManageMeeting gate.
 *
 * Keyed on the passed userId via the service-role client to avoid
 * series_participants RLS false-negatives on the membership lookup.
 */
export async function userManagesSeries(
  seriesId: string,
  userId: string
): Promise<boolean> {
  const admin = createServiceRoleClient();
  const [{ data: series }, { data: membership }] = await Promise.all([
    admin.from("meeting_series").select("owner_id").eq("id", seriesId).maybeSingle(),
    admin
      .from("series_participants")
      .select("role")
      .eq("series_id", seriesId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return (
    series?.owner_id === userId ||
    membership?.role === "owner" ||
    membership?.role === "facilitator"
  );
}
