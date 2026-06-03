import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeTokens } from "@/lib/google-calendar";
import { GOOGLE_WORKSPACE_SCOPES } from "@/lib/google-oauth-scopes";
import type { Session } from "@supabase/supabase-js";

async function storeGoogleProviderTokens(session: Session) {
  if (
    !session.provider_token ||
    !session.provider_refresh_token ||
    !session.user.email ||
    !process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  ) {
    return;
  }

  try {
    await storeTokens(
      session.user.id,
      session.provider_token,
      session.provider_refresh_token,
      session.expires_in || 3600,
      session.user.email,
      GOOGLE_WORKSPACE_SCOPES.split(" ")
    );
  } catch (err) {
    console.error("Failed to store Google provider tokens:", err);
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.session) {
        await storeGoogleProviderTokens(data.session);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
