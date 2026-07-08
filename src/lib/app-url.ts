export function absoluteAppUrl(requestUrl: string, path = "/"): string {
  const requestOrigin = new URL(requestUrl).origin;
  const base =
    process.env.PLAYWRIGHT_BASE_URL ||
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    requestOrigin;
  return new URL(path, base).toString();
}

// GoTrue stamps action links (recovery/invite/confirmation) with the Host of the
// request that generated them. Server-side generateLink calls reach GoTrue over
// the internal Docker hostname (e.g. http://supabase-kong:8000), so the emailed
// link points at an address the user's browser cannot resolve. The link is a
// Supabase /auth/v1/verify URL, so rewrite its origin to the public, browser-facing
// Supabase base (NEXT_PUBLIC_SUPABASE_URL: the app domain in single-origin prod,
// the Supabase URL elsewhere). That origin comes from trusted server config, never
// the request Host, so it cannot be poisoned to leak the token. The path and query
// (token, type, redirect_to) are copied verbatim to preserve URL-encoding.
export function toPublicActionLink(actionLink: string): string {
  const publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!publicBase) return actionLink;
  const link = new URL(actionLink);
  return `${new URL(publicBase).origin}${link.pathname}${link.search}`;
}
