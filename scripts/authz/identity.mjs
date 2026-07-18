// Hermetic authz harness — identity minting. Lifted verbatim from
// scripts/verify-authz-spike.test.mjs: unsigned-but-structurally-valid JWTs and the
// @supabase/ssr storage-cookie format, so bundled real guard code can validate a "session"
// against a fixture fetch without ever contacting real Supabase or signing anything.

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

// Derived the same way the app does (src/lib/supabase/auth-cookie.ts): sb-<host-label>-auth-token.
// Falls back to undefined if NEXT_PUBLIC_SUPABASE_URL is unset/unparseable at import time.
export function cookieName() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return undefined;
  try {
    return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  } catch {
    return undefined;
  }
}

export const COOKIE_NAME = cookieName();

export function gotrueUser(uuid, email, extra = {}) {
  const nowIso = new Date().toISOString();
  return {
    id: uuid,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: nowIso,
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: nowIso,
    updated_at: nowIso,
    ...extra,
  };
}

export function mintJwt(uuid, { email, role = "authenticated" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { sub: uuid, role, aud: "authenticated", exp: now + 3600, email };
  return `${b64url(header)}.${b64url(payload)}.x`;
}

export function mintCookie(uuid, { email }) {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: mintJwt(uuid, { email }),
    refresh_token: "rt",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: gotrueUser(uuid, email),
  };
  return "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
}

export function bearerToken(authHeaderValue) {
  const m = authHeaderValue?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

export function decodeSub(jwt) {
  const parts = String(jwt).split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).sub;
  } catch {
    return null;
  }
}

// Single-cookie Cookie header. Throws rather than silently chunking so a future bloated
// session (extra claims, embedded metadata) fails loudly instead of producing a request
// that real browsers would have split across sb-*-auth-token.0/.1/... chunks.
export function cookieHeader(cookieValue) {
  if (cookieValue.length >= 3180) {
    throw new Error(
      `cookieHeader: value is ${cookieValue.length} chars (>= 3180), would require chunking; not implemented`
    );
  }
  return `${COOKIE_NAME}=${cookieValue}`;
}
