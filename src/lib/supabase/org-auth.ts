import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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
