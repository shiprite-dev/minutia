import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// ---------------------------------------------------------------------------
// Per-user rate limiting for companion authorization.
// Max 5 authorizations per user per 10 minutes. In-memory Map keyed by user id.
// Mirrors the password-reset-requests limiter (prod-only so parallel e2e/
// integration workers reusing the same user are not throttled).
// ---------------------------------------------------------------------------
const AUTHORIZE_RATE_LIMIT_MAX = 5;
const AUTHORIZE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const authorizeRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isAuthorizeRateLimited(userId: string): boolean {
  if (process.env.NODE_ENV !== "production") return false;

  const now = Date.now();
  const entry = authorizeRateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    authorizeRateLimitMap.set(userId, {
      count: 1,
      resetAt: now + AUTHORIZE_RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }

  entry.count++;
  return entry.count > AUTHORIZE_RATE_LIMIT_MAX;
}

// Mints a single-use magic-link token_hash for the SIGNED-IN BROWSER USER only,
// so the desktop companion can complete a GoTrue verifyOTP exchange for that same
// account. Cookie session is required: a Bearer-only or anonymous caller is a
// desktop/API client and must not be able to mint its own authorization token.
export async function POST() {
  const cookieStore = await cookies();
  const hasAuthCookie = cookieStore
    .getAll()
    .some((cookie) => cookie.name.includes("-auth-token"));

  if (!hasAuthCookie) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (isAuthorizeRateLimited(user.id)) {
    return NextResponse.json(
      {
        error:
          "Too many authorization requests. Please wait a few minutes before trying again.",
      },
      { status: 429 }
    );
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });

  if (error || !data.properties?.hashed_token) {
    return NextResponse.json(
      { error: "Failed to authorize the companion app" },
      { status: 500 }
    );
  }

  // Return ONLY the token_hash. The action_link and email_otp are secrets that
  // must never leave the server or reach logs.
  return NextResponse.json({ token_hash: data.properties.hashed_token });
}
