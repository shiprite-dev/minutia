import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { userManagesSeries } from "@/lib/series/manage-access";

type OrgAdminResult =
  | { authorized: true; userId: string; organizationId: string }
  | { authorized: false; status: number; error: string };

export async function requireCurrentOrgAdmin(): Promise<OrgAdminResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { authorized: false, status: 401, error: "Not authenticated" };
  }

  const serviceClient = createServiceRoleClient();
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("current_organization_id, role")
    .eq("id", user.id)
    .single();

  const organizationId = profile?.current_organization_id;
  if (!organizationId) {
    return { authorized: false, status: 403, error: "No active organization" };
  }

  const { data: membership } = await serviceClient
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single();

  const isInstanceAdmin = profile?.role === "admin";
  if (membership?.role !== "admin" && !isInstanceAdmin) {
    return { authorized: false, status: 403, error: "Organization admin access required" };
  }

  return { authorized: true, userId: user.id, organizationId };
}

type SeriesInviterResult =
  | { authorized: true; userId: string; organizationId: string; isOrgAdmin: boolean }
  | { authorized: false; status: number; error: string };

/** Org admins, and the people who run the series, may invite colleagues into
 * the workspace from that series. The series must belong to the caller's
 * current workspace. */
export async function requireSeriesInviter(seriesId: string): Promise<SeriesInviterResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { authorized: false, status: 401, error: "Not authenticated" };

  const serviceClient = createServiceRoleClient();
  const [{ data: profile }, { data: series }] = await Promise.all([
    serviceClient.from("profiles").select("current_organization_id, role").eq("id", user.id).single(),
    serviceClient.from("meeting_series").select("organization_id").eq("id", seriesId).maybeSingle(),
  ]);
  const organizationId = profile?.current_organization_id;
  if (!organizationId) return { authorized: false, status: 403, error: "No active organization" };
  if (!series || series.organization_id !== organizationId) {
    return { authorized: false, status: 404, error: "Series not found" };
  }

  const { data: membership } = await serviceClient
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single();
  const isOrgAdmin = membership?.role === "admin" || profile?.role === "admin";
  if (!isOrgAdmin && !(await userManagesSeries(seriesId, user.id))) {
    return { authorized: false, status: 403, error: "Only people who run this series can invite to it" };
  }
  return { authorized: true, userId: user.id, organizationId, isOrgAdmin };
}
