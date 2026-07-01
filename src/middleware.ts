import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAuthCookieName } from "@/lib/supabase/auth-cookie";
import { getSupabaseServerUrl } from "@/lib/supabase/url";
import { getClientIp } from "@/lib/trusted-proxy";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  "X-DNS-Prefetch-Control": "on",
};

const SENSITIVE_PROBE_PATHS = new Set([
  "/.env",
  "/.env.local",
  "/.env.production",
  "/account.json",
  "/actuator/env",
  "/api/env",
  "/appsettings.json",
  "/credentials.json",
  "/keyfile.json",
]);

function isSensitiveProbePath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return (
    SENSITIVE_PROBE_PATHS.has(normalized) ||
    normalized.startsWith("/.env.") ||
    normalized.startsWith("/cdn-cgi/scripts/")
  );
}

// ---------------------------------------------------------------------------
// Setup completion cache (avoids DB hit on every request after setup)
// ---------------------------------------------------------------------------
let setupCompletedCache: boolean | null = null;

async function isSetupCompleted(): Promise<boolean> {
  if (setupCompletedCache === true) return true;

  try {
    const url = getSupabaseServerUrl();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return true;

    const admin = createSupabaseAdmin(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data } = await admin
      .from("instance_config")
      .select("value")
      .eq("key", "setup_completed")
      .single();

    const completed = data?.value === "true";
    if (completed) setupCompletedCache = true;
    return completed;
  } catch {
    return true;
  }
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count++;
  return entry.count > limit;
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  // Realtime connects over ws/wss to the Supabase host. http:// -> ws://,
  // https:// -> wss://. Without this, realtime is blocked on local dev and on
  // self-hosted instances with a custom Supabase URL (Cloud uses *.supabase.co).
  const supabaseWsUrl = supabaseUrl.replace(/^http/, "ws");
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${supabaseUrl} ${supabaseWsUrl} wss://*.supabase.co`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

function safeNextPath(pathname: string, search: string) {
  return `${pathname}${search}`;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const ip = getClientIp(request.headers);

  if (isSensitiveProbePath(pathname)) {
    return applySecurityHeaders(new NextResponse("Not Found", { status: 404 }));
  }

  if (pathname.startsWith("/api/")) {
    const apiRateLimit = process.env.NODE_ENV === "production" ? 100 : 2_000;
    if (isRateLimited(ip, apiRateLimit, 60_000)) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }
  }

  if (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/accept-invite" ||
    pathname === "/auth/callback" ||
    pathname === "/reset-password"
  ) {
    // Use a higher limit in development to avoid blocking parallel test workers.
    const authRateLimit = process.env.NODE_ENV === "production" ? 10 : 200;
    if (isRateLimited(`auth:${ip}`, authRateLimit, 60_000)) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }
  }

  // Setup guard: redirect to /setup if instance hasn't been configured
  const setupExemptPaths = ["/setup", "/api/setup", "/api/admin", "/api/calendar/webhook", "/retro", "/api/retro"];
  const isSetupExempt = setupExemptPaths.some((p) => pathname.startsWith(p));

  if (!isSetupExempt) {
    const completed = await isSetupCompleted();
    if (!completed) {
      const url = request.nextUrl.clone();
      url.pathname = "/setup";
      const redirect = NextResponse.redirect(url);
      return applySecurityHeaders(redirect);
    }
  }

  // Public sign-up is managed-cloud only. When the build flag is off (self-host
  // default), the dedicated /signup screen is unreachable; fall back to login.
  if (
    pathname === "/signup" &&
    process.env.NEXT_PUBLIC_ENABLE_PUBLIC_SIGNUP !== "true"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  let supabaseResponse = NextResponse.next({ request });
  const cookieName = getSupabaseAuthCookieName();

  const supabase = createServerClient(
    getSupabaseServerUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: cookieName ? { name: cookieName } : undefined,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const publicPaths = [
    "/",
    "/login",
    "/signup",
    "/accept-invite",
    "/auth/callback",
    "/reset-password",
    "/share",
    "/setup",
    "/api/setup",
    "/api/admin",
    "/api/invite-requests",
    "/api/password-reset-requests",
    "/api/calendar/webhook",
    "/retro",
    "/api/retro",
  ];
  const isPublicPath =
    publicPaths.some((p) => pathname === p) ||
    publicPaths.some((p) => p !== "/" && pathname.startsWith(p));

  if (!user && !isPublicPath) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Not authenticated" }, { status: 401 })
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", safeNextPath(pathname, request.nextUrl.search));
    const redirect = NextResponse.redirect(url);
    return applySecurityHeaders(redirect);
  }

  // Authenticated users hitting the landing page go to the dashboard.
  if (user && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    const redirect = NextResponse.redirect(url);
    return applySecurityHeaders(redirect);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//")
      ? new URL(next, request.url)
      : new URL("/dashboard", request.url);
    url.pathname = target.pathname;
    url.search = target.search;
    const redirect = NextResponse.redirect(url);
    return applySecurityHeaders(redirect);
  }

  return applySecurityHeaders(supabaseResponse);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
