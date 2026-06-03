import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { storeTokens } from "@/lib/google-calendar";
import { googleCalendarSettingsRedirectUrl } from "@/lib/google-oauth-redirect";
import { GOOGLE_WORKSPACE_SCOPES } from "@/lib/google-oauth-scopes";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

function redirectToSettings(request: NextRequest, path: string) {
  return NextResponse.redirect(googleCalendarSettingsRedirectUrl(request.url, path));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return redirectToSettings(request, "/settings?gcal=error");
  }

  if (!code || !state) {
    return redirectToSettings(request, "/settings?gcal=error");
  }

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("gcal_oauth_state")?.value;
  cookieStore.delete("gcal_oauth_state");

  if (!stateCookie) {
    return redirectToSettings(request, "/settings?gcal=error");
  }

  const [savedState, userId] = stateCookie.split(":");
  if (savedState !== state || !userId) {
    return redirectToSettings(request, "/settings?gcal=error");
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    }),
  });

  if (!tokenRes.ok) {
    return redirectToSettings(request, "/settings?gcal=error");
  }

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    return redirectToSettings(request, "/settings?gcal=error&reason=no_refresh");
  }

  const userinfoRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userinfo = userinfoRes.ok ? await userinfoRes.json() : { email: "unknown" };

  try {
    await storeTokens(
      userId,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in,
      userinfo.email,
      typeof tokens.scope === "string"
        ? tokens.scope.split(/\s+/).filter(Boolean)
        : GOOGLE_WORKSPACE_SCOPES.split(" ")
    );
  } catch (err) {
    console.error("Failed to store Google tokens:", err);
    return redirectToSettings(request, "/settings?gcal=error&reason=store_failed");
  }

  return redirectToSettings(request, "/settings?gcal=connected");
}
