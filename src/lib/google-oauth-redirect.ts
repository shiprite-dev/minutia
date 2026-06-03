function originFromUrl(value: string | undefined) {
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function googleCalendarSettingsRedirectUrl(requestUrl: string, path: string) {
  const base =
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    originFromUrl(process.env.GOOGLE_REDIRECT_URI) ||
    new URL(requestUrl).origin;

  return new URL(path, base);
}
