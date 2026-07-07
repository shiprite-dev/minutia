const AUTH_PATHS = new Set([
  "/login",
  "/signup",
  "/accept-invite",
  "/auth/callback",
  "/reset-password",
]);

export type AuthRateBudget = { bucket: "auth-attempt" | "auth-page"; limit: number };

export function authRateBudget(
  pathname: string,
  method: string,
  isProduction: boolean
): AuthRateBudget | null {
  if (!AUTH_PATHS.has(pathname)) return null;
  if (method === "GET" || method === "HEAD") {
    return { bucket: "auth-page", limit: isProduction ? 120 : 2_000 };
  }
  return { bucket: "auth-attempt", limit: isProduction ? 10 : 200 };
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function isRateLimited(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): boolean {
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count++;
  return entry.count > limit;
}
