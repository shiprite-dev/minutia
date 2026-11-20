import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { bearerTokenFromHeader } from "@/lib/supabase/bearer";
import { isFreshToken, sha256Hex, tokenIssuedAt } from "@/lib/companion/web-handoff";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// Prod-only so parallel e2e workers reusing one account are not throttled (same as the authorize route).
function isRateLimited(userId: string): boolean {
  if (process.env.NODE_ENV !== "production") return false;

  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

const notAuthenticated = () =>
  NextResponse.json({ error: "Not authenticated" }, { status: 401 });

// Mints a one-time sign-in for the Mac app's own web window. Bearer only: a browser cookie
// session must never be able to mint a token that signs another browser in.
export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (cookieStore.getAll().some((cookie) => cookie.name.includes("-auth-token"))) {
    return notAuthenticated();
  }

  const bearer = bearerTokenFromHeader(request.headers.get("authorization"));
  if (!bearer) return notAuthenticated();

  const admin = createServiceRoleClient();
  const {
    data: { user },
  } = await admin.auth.getUser(bearer);
  if (!user?.email) return notAuthenticated();

  if (!isFreshToken(tokenIssuedAt(bearer), Math.floor(Date.now() / 1000))) {
    return NextResponse.json(
      { error: "Sign in again to open this meeting.", code: "stale_token" },
      { status: 401 },
    );
  }

  if (!user.email_confirmed_at) {
    return NextResponse.json({ error: "Confirm your email first." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const nonceDigest = body?.nonce_digest;
  if (typeof nonceDigest !== "string" || !/^[0-9a-f]{64}$/.test(nonceDigest)) {
    return NextResponse.json({ error: "nonce_digest is required" }, { status: 400 });
  }

  if (isRateLimited(user.id)) {
    return NextResponse.json(
      { error: "Too many sign-in requests. Please wait a few minutes before trying again." },
      { status: 429 },
    );
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    return NextResponse.json({ error: "Couldn't open the meeting window" }, { status: 500 });
  }

  const { error: insertError } = await admin.from("companion_web_handoffs").insert({
    user_id: user.id,
    token_digest: sha256Hex(tokenHash),
    nonce_digest: nonceDigest,
  });
  if (insertError) {
    return NextResponse.json({ error: "Couldn't open the meeting window" }, { status: 500 });
  }

  return NextResponse.json({ token_hash: tokenHash });
}
