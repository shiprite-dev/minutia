function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function forwardedOrigin(request: Request) {
  const host =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ||
    firstHeaderValue(request.headers.get("host"));
  if (!host) return null;

  const proto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ||
    new URL(request.url).protocol.replace(":", "");

  return normalizeOrigin(`${proto}://${host}`);
}

export function publicAuthCallbackOrigin(request: Request) {
  return (
    normalizeOrigin(process.env.SITE_URL) ||
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ||
    forwardedOrigin(request) ||
    new URL(request.url).origin
  );
}

export function safeAuthNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
