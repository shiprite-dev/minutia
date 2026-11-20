import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function loadSeriesMembers(seriesId: string) {
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
