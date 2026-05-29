import { NextResponse, type NextRequest } from "next/server";

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

function forwardedOrigin(request: NextRequest) {
  const host =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ||
    firstHeaderValue(request.headers.get("host"));
  if (!host) return null;

  const proto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ||
    new URL(request.url).protocol.replace(":", "");

  return normalizeOrigin(`${proto}://${host}`);
}

export function rejectCrossOrigin(request: NextRequest) {
  const origin = normalizeOrigin(request.headers.get("origin"));
  if (!origin) return null;

  const allowedOrigins = new Set(
    [
      normalizeOrigin(request.url),
      forwardedOrigin(request),
      normalizeOrigin(process.env.SITE_URL),
      normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL),
    ].filter(Boolean)
  );

  return allowedOrigins.has(origin)
    ? null
    : NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
}
