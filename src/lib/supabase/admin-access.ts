import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type AdminAccess = {
  userId: string;
  instanceAdmin: boolean;
  orgAdmin: boolean;
};

// Two distinct admin kinds gate /admin: an instance admin (profiles.role) runs the
// whole deployment; an org admin (organization_members.role) runs workspace access.
// Overview/Settings/Health are instance administration; Users is workspace
// administration, open to both.
export async function resolveAdminAccess(): Promise<AdminAccess | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceRoleClient();
  const { data: profile } = await service
    .from("profiles")
    .select("role, current_organization_id")
    .eq("id", user.id)
    .single();

  const instanceAdmin = profile?.role === "admin";

  let orgAdmin = false;
  const organizationId = profile?.current_organization_id;
  if (organizationId) {
    const { data: membership } = await service
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .single();
    orgAdmin = membership?.role === "admin";
  }

  return { userId: user.id, instanceAdmin, orgAdmin };
}
