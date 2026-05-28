import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireSetupToken } from "@/lib/setup-token";
import type { NextRequest } from "next/server";

type AuthResult =
  | { authorized: true; userId: string }
  | { authorized: false; status: number; error: string };

export async function requireAdmin(request?: NextRequest): Promise<AuthResult> {
  const serviceClient = createServiceRoleClient();

  const { data: configData } = await serviceClient
    .from("instance_config")
    .select("value")
    .eq("key", "setup_completed")
    .single();

  if (configData?.value !== "true") {
    if (request) {
      const setupAuth = requireSetupToken(request);
      if (!setupAuth.authorized) {
        return setupAuth;
      }
    }

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
