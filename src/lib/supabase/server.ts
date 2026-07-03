import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { bearerTokenFromHeader } from "./bearer";
import { getSupabaseAuthCookieName } from "./auth-cookie";
import { getSupabaseServerUrl } from "./url";

export async function createClient() {
  const cookieStore = await cookies();
  const cookieName = getSupabaseAuthCookieName();

  const hasAuthCookie = cookieStore
    .getAll()
    .some((cookie) => cookie.name.includes("-auth-token"));
  const bearer = hasAuthCookie
    ? null
    : bearerTokenFromHeader((await headers()).get("authorization"));

  const client = createServerClient(
    getSupabaseServerUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: cookieName ? { name: cookieName } : undefined,
      global: bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component where cookies can't be set.
            // This is expected when using the server client in a Server Component.
          }
        },
      },
    }
  );

  if (bearer) {
    const baseGetUser = client.auth.getUser.bind(client.auth);
    client.auth.getUser = ((jwt?: string) =>
      baseGetUser(jwt ?? bearer)) as typeof client.auth.getUser;
  }

  return client;
}
