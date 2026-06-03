export const GOOGLE_IDENTITY_SCOPES = "openid email profile";

export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

export const GOOGLE_DIRECTORY_SCOPE =
  "https://www.googleapis.com/auth/directory.readonly";

export const GOOGLE_WORKSPACE_SCOPES = [
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_DIRECTORY_SCOPE,
  "email",
].join(" ");
