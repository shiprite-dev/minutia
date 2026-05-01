import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { storeTokens } from "@/lib/google-calendar";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/settings?gcal=error", request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings?gcal=error", request.url));
  }

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("gcal_oauth_state")?.value;
  cookieStore.delete("gcal_oauth_state");

  if (!stateCookie) {
    return NextResponse.redirect(new URL("/settings?gcal=error", request.url));
  }

  const [savedState, userId] = stateCookie.split(":");
  if (savedState !== state || !userId) {
    return NextResponse.redirect(new URL("/settings?gcal=error", request.url));
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
    return NextResponse.redirect(new URL("/settings?gcal=error", request.url));
  }

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/settings?gcal=error&reason=no_refresh", request.url));
  }

  const userinfoRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userinfo = userinfoRes.ok ? await userinfoRes.json() : { email: "unknown" };

  await storeTokens(
    userId,
    tokens.access_token,
    tokens.refresh_token,
    tokens.expires_in,
    userinfo.email
  );

  return NextResponse.redirect(new URL("/settings?gcal=connected", request.url));
}
