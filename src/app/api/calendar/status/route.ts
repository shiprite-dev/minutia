import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_DIRECTORY_SCOPE,
} from "@/lib/google-oauth-scopes";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data } = await supabase
    .from("google_oauth_tokens")
    .select("google_email, scopes")
    .eq("user_id", user.id)
    .single();

  const scopes = Array.isArray(data?.scopes) ? data.scopes : [];

  return NextResponse.json({
    connected: scopes.includes(GOOGLE_CALENDAR_SCOPE),
    directoryConnected: scopes.includes(GOOGLE_DIRECTORY_SCOPE),
    googleEmail: data?.google_email ?? null,
  });
}
