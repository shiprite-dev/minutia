import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-DNS-Prefetch-Control": "on",
};

// ---------------------------------------------------------------------------
// Setup completion cache (avoids DB hit on every request after setup)
// ---------------------------------------------------------------------------
let setupCompletedCache: boolean | null = null;

async function isSetupCompleted(): Promise<boolean> {
  if (setupCompletedCache === true) return true;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
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

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${supabaseUrl} wss://*.supabase.co`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const ip = getClientIp(request);

  if (pathname.startsWith("/api/")) {
    if (isRateLimited(ip, 100, 60_000)) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }
  }

  if (pathname === "/login" || pathname === "/auth/callback") {
    // Use a higher limit in development to avoid blocking parallel test workers.
    const authRateLimit = process.env.NODE_ENV === "production" ? 10 : 200;
    if (isRateLimited(`auth:${ip}`, authRateLimit, 60_000)) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }
  }

  // Setup guard: redirect to /setup if instance hasn't been configured
  const setupExemptPaths = ["/setup", "/api/setup", "/api/admin"];
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

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  const publicPaths = ["/login", "/auth/callback", "/share", "/setup", "/api/setup", "/api/admin"];
  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    return applySecurityHeaders(redirect);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
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
