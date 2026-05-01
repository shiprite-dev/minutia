import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data } = await supabase
    .from("google_oauth_tokens")
    .select("google_email")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({
    connected: !!data,
    googleEmail: data?.google_email ?? null,
  });
}
