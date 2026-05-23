import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerUrl } from "./url";

export function createServiceRoleClient() {
  const url = getSupabaseServerUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  return createSupabaseClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
