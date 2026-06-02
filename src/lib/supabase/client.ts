import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAuthCookieName } from "./auth-cookie";

export function createClient() {
  const cookieName = getSupabaseAuthCookieName();

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    cookieName ? { cookieOptions: { name: cookieName } } : undefined
  );
}
