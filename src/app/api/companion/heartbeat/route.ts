import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The desktop companion app POSTs here with its Bearer token to mark itself
// alive. createClient() honors the Authorization: Bearer <user JWT> header when
// no auth cookie is present, so this is a thin BFF write on the caller's own
// row: no service role, RLS + the column grant scope it to the caller.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ companion_last_seen_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
