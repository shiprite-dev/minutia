import { createHash, randomBytes, randomUUID } from "node:crypto";
import { absoluteAppUrl } from "./app-url";
import { watchCalendarEvents } from "./google-calendar";
import { createServiceRoleClient } from "./supabase/service-role";

const DEFAULT_CHANNEL_TTL_SECONDS = 604800;
const WEBHOOK_PATH = "/api/calendar/webhook";

export type GoogleCalendarWatchChannelRow = {
  id: string;
  user_id: string;
  organization_id: string;
  calendar_id: string;
  channel_id: string;
  channel_token_hash: string;
  resource_id: string | null;
  resource_uri: string | null;
  status: "creating" | "active" | "failed" | "stopped" | "expired";
  expiration_at: string | null;
  last_message_number: number | string | null;
};

export type CalendarWatchNotification = {
  channelId: string | null;
  channelToken: string | null;
  resourceId: string | null;
  resourceUri: string | null;
  resourceState: string | null;
  messageNumber: number | null;
  channelExpiration: string | null;
};

export function hashCalendarChannelToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createChannelToken() {
  return randomBytes(32).toString("base64url");
}

function toIsoFromMillis(value: number | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

function toIsoFromHeader(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function calendarWebhookUrl(requestUrl: string) {
  const configured = process.env.GOOGLE_CALENDAR_WEBHOOK_URL;
  const url = new URL(configured || absoluteAppUrl(requestUrl, WEBHOOK_PATH));

  if (url.protocol !== "https:") {
    throw new Error("Google Calendar webhook URL must use HTTPS");
  }

  return url.toString();
}

export async function createOrRenewCalendarWatchChannel({
  userId,
  organizationId,
  calendarId,
  accessToken,
  webhookUrl,
  ttlSeconds = DEFAULT_CHANNEL_TTL_SECONDS,
  channelId = randomUUID(),
  channelToken = createChannelToken(),
}: {
  userId: string;
  organizationId: string;
  calendarId: string;
  accessToken: string;
  webhookUrl: string;
  ttlSeconds?: number;
  channelId?: string;
  channelToken?: string;
}) {
  const supabase = createServiceRoleClient();
  const tokenHash = hashCalendarChannelToken(channelToken);
  const requestedExpirationAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const { data: pending, error: insertError } = await supabase
    .from("google_calendar_watch_channels")
    .insert({
      user_id: userId,
      organization_id: organizationId,
      calendar_id: calendarId,
      channel_id: channelId,
      channel_token_hash: tokenHash,
      status: "creating",
      expiration_at: requestedExpirationAt,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError) throw insertError;

  try {
    const channel = await watchCalendarEvents({
      accessToken,
      calendarId,
      channelId,
      channelToken,
      webhookUrl,
      ttlSeconds,
    });

    const { data, error } = await supabase
      .from("google_calendar_watch_channels")
      .update({
        resource_id: channel.resourceId,
        resource_uri: channel.resourceUri,
        expiration_at: toIsoFromMillis(channel.expiration) ?? requestedExpirationAt,
        status: "active",
        last_renewed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", pending.id)
      .select("id, channel_id, resource_id, resource_uri, expiration_at, status")
      .single<{
        id: string;
        channel_id: string;
        resource_id: string | null;
        resource_uri: string | null;
        expiration_at: string | null;
        status: string;
      }>();

    if (error) throw error;
    return {
      id: data.id,
      channelId: data.channel_id,
      resourceId: data.resource_id,
      resourceUri: data.resource_uri,
      expirationAt: data.expiration_at,
      status: data.status,
    };
  } catch (err) {
    await supabase
      .from("google_calendar_watch_channels")
      .update({
        status: "failed",
        error_message: err instanceof Error ? err.message : "Calendar watch failed",
      })
      .eq("id", pending.id);
    throw err;
  }
}

export function parseCalendarWatchNotification(headers: Headers): CalendarWatchNotification {
  const messageNumber = headers.get("x-goog-message-number");

  return {
    channelId: headers.get("x-goog-channel-id"),
    channelToken: headers.get("x-goog-channel-token"),
    resourceId: headers.get("x-goog-resource-id"),
    resourceUri: headers.get("x-goog-resource-uri"),
    resourceState: headers.get("x-goog-resource-state"),
    messageNumber: messageNumber ? Number(messageNumber) : null,
    channelExpiration: headers.get("x-goog-channel-expiration"),
  };
}

function isValidMessageNumber(messageNumber: number | null): messageNumber is number {
  return (
    typeof messageNumber === "number" &&
    Number.isFinite(messageNumber) &&
    messageNumber > 0
  );
}

function parseStoredMessageNumber(value: number | string | null) {
  if (value === null) return null;
  const messageNumber = Number(value);
  return Number.isFinite(messageNumber) ? messageNumber : null;
}

async function updateCalendarWatchChannelStatus(id: string, status: "expired" | "stopped") {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("google_calendar_watch_channels")
    .update({ status })
    .eq("id", id);

  if (error) throw error;
}

export async function validateCalendarWatchNotification({
  channelId,
  channelToken,
  resourceId,
  messageNumber,
}: Pick<
  CalendarWatchNotification,
  "channelId" | "channelToken" | "resourceId" | "messageNumber"
>) {
  if (!channelId || !channelToken || !isValidMessageNumber(messageNumber)) {
    return { channel: null, responseStatus: 404 };
  }

  const supabase = createServiceRoleClient();
  const tokenHash = hashCalendarChannelToken(channelToken);
  const { data, error } = await supabase
    .from("google_calendar_watch_channels")
    .select(
      "id, user_id, organization_id, calendar_id, channel_id, channel_token_hash, resource_id, resource_uri, status, expiration_at, last_message_number"
    )
    .eq("channel_id", channelId)
    .eq("channel_token_hash", tokenHash)
    .in("status", ["creating", "active"])
    .maybeSingle<GoogleCalendarWatchChannelRow>();

  if (error) throw error;
  if (!data) return { channel: null, responseStatus: 404 };
  if (data.resource_id && resourceId && data.resource_id !== resourceId) {
    return { channel: null, responseStatus: 404 };
  }

  if (data.expiration_at) {
    const expirationMs = Date.parse(data.expiration_at);
    if (Number.isFinite(expirationMs) && expirationMs <= Date.now()) {
      await updateCalendarWatchChannelStatus(data.id, "expired");
      return { channel: null, responseStatus: 404 };
    }
  }

  const previousMessageNumber = parseStoredMessageNumber(data.last_message_number);
  if (previousMessageNumber !== null && messageNumber <= previousMessageNumber) {
    return { channel: null, responseStatus: 204 };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", data.organization_id)
    .eq("user_id", data.user_id)
    .maybeSingle<{ user_id: string }>();

  if (membershipError) throw membershipError;
  if (!membership) {
    await updateCalendarWatchChannelStatus(data.id, "stopped");
    return { channel: null, responseStatus: 404 };
  }

  return { channel: data, responseStatus: 202 };
}

export async function recordCalendarWatchNotification({
  channel,
  notification,
}: {
  channel: GoogleCalendarWatchChannelRow;
  notification: CalendarWatchNotification;
}) {
  const supabase = createServiceRoleClient();
  const expirationAt = toIsoFromHeader(notification.channelExpiration);
  const messageNumber = Number.isFinite(notification.messageNumber)
    ? notification.messageNumber
    : null;

  const { error } = await supabase
    .from("google_calendar_watch_channels")
    .update({
      resource_id: channel.resource_id ?? notification.resourceId,
      resource_uri: channel.resource_uri ?? notification.resourceUri,
      expiration_at: channel.expiration_at ?? expirationAt,
      last_message_number: messageNumber,
      last_resource_state: notification.resourceState,
      last_notification_at: new Date().toISOString(),
      status: channel.status === "creating" ? "active" : channel.status,
    })
    .eq("id", channel.id);

  if (error) throw error;
}
