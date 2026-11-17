export const GOOGLE_IDENTITY_SCOPES = "openid email profile";

export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

export const GOOGLE_DIRECTORY_SCOPE =
  "https://www.googleapis.com/auth/directory.readonly";

export const GOOGLE_WORKSPACE_SCOPES = [GOOGLE_CALENDAR_SCOPE, "email"].join(" ");

export const GOOGLE_OAUTH_QUERY_PARAMS = {
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: "true",
};

export async function fetchGrantedGoogleScopes(accessToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/tokeninfo", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return null;
  const { scope } = await res.json();
  return typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : null;
}
