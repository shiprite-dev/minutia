import { createClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "./crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiry: Date;
  googleEmail: string;
}

export async function getValidAccessToken(userId: string): Promise<string> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("google_oauth_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !data) throw new Error("Google account not connected");

  const expiry = new Date(data.token_expiry);
  const needsRefresh = expiry.getTime() < Date.now() + 5 * 60 * 1000;

  if (!needsRefresh) {
    return decrypt(data.access_token, data.token_iv);
  }

  const refreshToken = decrypt(data.refresh_token, data.refresh_iv);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const tokens = await res.json();
  const { ciphertext: newAccessToken, iv: newIv } = encrypt(tokens.access_token);
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);

  await supabase
    .from("google_oauth_tokens")
    .update({
      access_token: newAccessToken,
      token_iv: newIv,
      token_expiry: newExpiry.toISOString(),
    })
    .eq("user_id", userId);

  return tokens.access_token;
}

export async function storeTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  googleEmail: string
) {
  const supabase = getServiceClient();
  const { ciphertext: encAccess, iv: accessIv } = encrypt(accessToken);
  const { ciphertext: encRefresh, iv: refreshIv } = encrypt(refreshToken);
  const expiry = new Date(Date.now() + expiresIn * 1000);

  const { error } = await supabase.from("google_oauth_tokens").upsert(
    {
      user_id: userId,
      access_token: encAccess,
      token_iv: accessIv,
      refresh_token: encRefresh,
      refresh_iv: refreshIv,
      token_expiry: expiry.toISOString(),
      google_email: googleEmail,
    },
    { onConflict: "user_id" }
  );

  if (error) throw error;
}

export interface CalendarEntry {
  id: string;
  summary: string;
  primary: boolean;
}

export async function listCalendars(accessToken: string): Promise<CalendarEntry[]> {
  const res = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error(`Calendar list failed: ${res.status}`);
  const data = await res.json();

  return (data.items ?? []).map((item: any) => ({
    id: item.id,
    summary: item.summary ?? item.id,
    primary: item.primary ?? false,
  }));
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  htmlLink?: string;
}

export async function listUpcomingEvents(
  accessToken: string,
  calendarId: string,
  maxResults = 5
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  });

  const res = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) throw new Error(`Events fetch failed: ${res.status}`);
  const data = await res.json();

  return (data.items ?? []).map((item: any) => ({
    id: item.id,
    summary: item.summary ?? "(No title)",
    start: { dateTime: item.start?.dateTime, date: item.start?.date },
    end: { dateTime: item.end?.dateTime, date: item.end?.date },
    htmlLink: item.htmlLink,
  }));
}

export async function revokeToken(token: string) {
  await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

export async function deleteStoredTokens(userId: string) {
  const supabase = getServiceClient();
  await supabase.from("google_oauth_tokens").delete().eq("user_id", userId);
}
