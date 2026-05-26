export function absoluteAppUrl(requestUrl: string, path = "/"): string {
  const requestOrigin = new URL(requestUrl).origin;
  const base = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || requestOrigin;
  return new URL(path, base).toString();
}
