import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isFeatureGatingEnabled } from "@/lib/feature-access";

export async function requireAiAccess(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  if (!isFeatureGatingEnabled()) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("has_full_access")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    console.error(
      `[ai-access] deny profile-read-failure user=${user.id}` +
        (error ? ` error=${error.message}` : " reason=profile-missing"),
    );
    return NextResponse.json(
      { error: "Unable to verify access. Please try again." },
      { status: 403 },
    );
  }

  if (!profile.has_full_access) {
    console.error(
      `[ai-access] deny FEATURE_UNAVAILABLE user=${user.id} reason=entitlement-absent`,
    );
    return NextResponse.json(
      {
        error: "AI features are not enabled for this account.",
        code: "FEATURE_UNAVAILABLE",
      },
      { status: 403 },
    );
  }

  return null;
}

export async function hasAiAccess(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  if (!isFeatureGatingEnabled()) return true;

  const { data: profile } = await supabase
    .from("profiles")
    .select("has_full_access")
    .eq("id", user.id)
    .single();

  return profile?.has_full_access === true;
}
