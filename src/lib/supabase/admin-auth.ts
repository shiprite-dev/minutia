import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type AuthResult =
  | { authorized: true; userId: string }
  | { authorized: false; status: number; error: string };

export async function requireAdmin(): Promise<AuthResult> {
  const serviceClient = createServiceRoleClient();

  const { data: configData } = await serviceClient
    .from("instance_config")
    .select("value")
    .eq("key", "setup_completed")
    .single();

  if (configData?.value !== "true") {
    return { authorized: true, userId: "setup" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { authorized: false, status: 401, error: "Not authenticated" };
  }

  const { data: profile } = await serviceClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return { authorized: false, status: 403, error: "Admin access required" };
  }

  return { authorized: true, userId: user.id };
}
