import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken, revokeToken, deleteStoredTokens } from "@/lib/google-calendar";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const token = await getValidAccessToken(user.id);
    await revokeToken(token);
  } catch {
    // Token may already be invalid; proceed with deletion
  }

  await deleteStoredTokens(user.id);

  return NextResponse.json({ success: true });
}
