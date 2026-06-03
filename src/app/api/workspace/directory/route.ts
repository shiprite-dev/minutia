import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/google-calendar";
import {
  GoogleDirectoryPermissionError,
  searchWorkspaceDirectory,
} from "@/lib/google-workspace-directory";
import { GOOGLE_DIRECTORY_SCOPE } from "@/lib/google-oauth-scopes";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json({ people: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data } = await supabase
    .from("google_oauth_tokens")
    .select("scopes")
    .eq("user_id", user.id)
    .single();

  const scopes = Array.isArray(data?.scopes) ? data.scopes : [];
  if (!scopes.includes(GOOGLE_DIRECTORY_SCOPE)) {
    return NextResponse.json(
      { error: "Google Workspace directory access not connected" },
      { status: 403 }
    );
  }

  try {
    const accessToken = await getValidAccessToken(user.id);
    const people = await searchWorkspaceDirectory(accessToken, query);
    return NextResponse.json({ people });
  } catch (err) {
    if (err instanceof GoogleDirectoryPermissionError) {
      return NextResponse.json(
        { error: "Google Workspace directory access not granted" },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: "Directory search failed" }, { status: 500 });
  }
}
