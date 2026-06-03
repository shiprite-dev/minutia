import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { watchCalendarEvents } from "../../src/lib/google-calendar";
import {
  createOrRenewCalendarWatchChannel,
  hashCalendarChannelToken,
} from "../../src/lib/google-calendar-watch";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

function serviceHeaders(prefer = "return=minimal") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function rest(
  request: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...serviceHeaders(),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

async function prepareAppForSeedUser(request: APIRequestContext) {
  await rest(request, "instance_config?key=eq.setup_completed", {
    method: "PATCH",
    data: { value: "true" },
  });
  await rest(request, `profiles?id=eq.${TEST_USER_ID}`, {
    method: "PATCH",
    data: { has_completed_onboarding: true },
    headers: serviceHeaders("return=representation"),
  });
}

async function getSeedWorkspaceId(request: APIRequestContext) {
  const rows = await rest(
    request,
    `profiles?id=eq.${TEST_USER_ID}&select=current_organization_id`
  );
  expect(rows[0]?.current_organization_id).toBeTruthy();
  return rows[0].current_organization_id as string;
}

async function createAdditionalWorkspaceMember(
  request: APIRequestContext,
  organizationId: string
) {
  const email = `calendar-watch-${randomUUID()}@example.com`;
  const response = await request.fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    data: {
      email,
      password: "CalendarWatch123!",
      email_confirm: true,
    },
    headers: serviceHeaders(),
  });
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${text}`).toBeTruthy();
  const user = JSON.parse(text) as { id: string };

  await rest(request, "organization_members?on_conflict=organization_id,user_id", {
    method: "POST",
    data: {
      organization_id: organizationId,
      user_id: user.id,
      role: "member",
    },
    headers: serviceHeaders("resolution=merge-duplicates"),
  });

  return user.id;
}

async function deleteAuthUser(request: APIRequestContext, userId: string) {
  const response = await request.fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  expect(
    response.ok() || response.status() === 404,
    `${response.status()} ${await response.text()}`
  ).toBeTruthy();
}

async function createWatchChannel(
  request: APIRequestContext,
  orgId: string,
  options: {
    userId?: string;
    status?: "creating" | "active" | "failed" | "stopped" | "expired";
    expirationAt?: string;
    lastMessageNumber?: number;
  } = {}
) {
  const channelId = randomUUID();
  const token = `token-${randomUUID()}`;
  const rows = await rest(request, "google_calendar_watch_channels", {
    method: "POST",
    data: {
      user_id: options.userId ?? TEST_USER_ID,
      organization_id: orgId,
      calendar_id: "primary",
      channel_id: channelId,
      channel_token_hash: hashCalendarChannelToken(token),
      resource_id: "resource-1",
      resource_uri: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      status: options.status ?? "active",
      expiration_at:
        options.expirationAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      last_message_number: options.lastMessageNumber ?? null,
    },
    headers: serviceHeaders("return=representation"),
  });

  return { rowId: rows[0].id as string, channelId, token };
}

test.describe("Google Calendar push notifications", () => {
  test("creates an Events watch request with token, webhook address, and ttl", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl: URL | null = null;
    let requestedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = new URL(String(input));
      requestedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: requestedBody?.id,
          resourceId: "resource-1",
          resourceUri: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          expiration: 1780000000000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const channel = await watchCalendarEvents({
        accessToken: "access-token",
        calendarId: "primary",
        channelId: "channel-1",
        channelToken: "channel-token",
        webhookUrl: "https://app.example.com/api/calendar/webhook",
        ttlSeconds: 3600,
      });

      expect(requestedUrl?.toString()).toBe(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch"
      );
      expect(requestedBody).toEqual({
        id: "channel-1",
        type: "web_hook",
        address: "https://app.example.com/api/calendar/webhook",
        token: "channel-token",
        params: { ttl: "3600" },
      });
      expect(channel.resourceId).toBe("resource-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("webhook rejects an invalid channel token", async ({ request }) => {
    await prepareAppForSeedUser(request);
    const orgId = await getSeedWorkspaceId(request);
    const { rowId, channelId } = await createWatchChannel(request, orgId);

    try {
      const response = await request.post("/api/calendar/webhook", {
        headers: {
          "X-Goog-Channel-ID": channelId,
          "X-Goog-Channel-Token": "wrong-token",
          "X-Goog-Resource-ID": "resource-1",
          "X-Goog-Resource-State": "exists",
          "X-Goog-Message-Number": "2",
        },
      });

      expect(response.status()).toBe(404);
    } finally {
      await rest(request, `google_calendar_watch_channels?id=eq.${rowId}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
  });

  test("webhook records sync and exists notifications for a valid channel", async ({
    request,
  }) => {
    await prepareAppForSeedUser(request);
    const orgId = await getSeedWorkspaceId(request);
    const { rowId, channelId, token } = await createWatchChannel(request, orgId);

    try {
      for (const [state, messageNumber] of [
        ["sync", "1"],
        ["exists", "2"],
      ] as const) {
        const response = await request.post("/api/calendar/webhook", {
          headers: {
            "X-Goog-Channel-ID": channelId,
            "X-Goog-Channel-Token": token,
            "X-Goog-Resource-ID": "resource-1",
            "X-Goog-Resource-State": state,
            "X-Goog-Message-Number": messageNumber,
          },
        });

        expect(response.status()).toBe(202);
      }

      const rows = await rest(
        request,
        `google_calendar_watch_channels?id=eq.${rowId}&select=last_resource_state,last_message_number,last_notification_at`
      );
      expect(rows[0].last_resource_state).toBe("exists");
      expect(rows[0].last_message_number).toBe(2);
      expect(rows[0].last_notification_at).toBeTruthy();
    } finally {
      await rest(request, `google_calendar_watch_channels?id=eq.${rowId}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
  });

  test("channel renewal stores only the token hash", async ({ request }) => {
    await prepareAppForSeedUser(request);
    const orgId = await getSeedWorkspaceId(request);
    const originalFetch = globalThis.fetch;
    const rawToken = `renew-${randomUUID()}`;
    let channelId = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("www.googleapis.com/calendar")) {
        return originalFetch(input, init);
      }

      const body = JSON.parse(String(init?.body));
      channelId = body.id;
      return new Response(
        JSON.stringify({
          id: body.id,
          resourceId: "resource-renewed",
          resourceUri: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          expiration: 1780000000000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      await createOrRenewCalendarWatchChannel({
        userId: TEST_USER_ID,
        organizationId: orgId,
        calendarId: "primary",
        accessToken: "access-token",
        webhookUrl: "https://app.example.com/api/calendar/webhook",
        ttlSeconds: 3600,
        channelToken: rawToken,
      });

      const rows = await rest(
        request,
        `google_calendar_watch_channels?channel_id=eq.${channelId}&select=channel_token_hash,resource_id,status`
      );
      expect(rows[0].channel_token_hash).toBe(hashCalendarChannelToken(rawToken));
      expect(JSON.stringify(rows[0])).not.toContain(rawToken);
      expect(rows[0].resource_id).toBe("resource-renewed");
      expect(rows[0].status).toBe("active");
    } finally {
      globalThis.fetch = originalFetch;
      if (channelId) {
        await rest(request, `google_calendar_watch_channels?channel_id=eq.${channelId}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
    }
  });

  test("webhook rejects a channel after workspace membership is removed", async ({
    request,
  }) => {
    await prepareAppForSeedUser(request);
    const orgId = await getSeedWorkspaceId(request);
    const memberId = await createAdditionalWorkspaceMember(request, orgId);
    const { rowId, channelId, token } = await createWatchChannel(request, orgId, {
      userId: memberId,
    });

    try {
      await rest(
        request,
        `organization_members?organization_id=eq.${orgId}&user_id=eq.${memberId}`,
        { method: "DELETE" }
      );

      const response = await request.post("/api/calendar/webhook", {
        headers: {
          "X-Goog-Channel-ID": channelId,
          "X-Goog-Channel-Token": token,
          "X-Goog-Resource-ID": "resource-1",
          "X-Goog-Resource-State": "exists",
          "X-Goog-Message-Number": "2",
        },
      });

      expect(response.status()).toBe(404);
      const rows = await rest(
        request,
        `google_calendar_watch_channels?id=eq.${rowId}&select=status,last_resource_state,last_message_number`
      );
      expect(rows[0].status).toBe("stopped");
      expect(rows[0].last_resource_state).toBeNull();
      expect(rows[0].last_message_number).toBeNull();
    } finally {
      await rest(request, `google_calendar_watch_channels?id=eq.${rowId}`, {
        method: "DELETE",
      }).catch(() => undefined);
      await deleteAuthUser(request, memberId).catch(() => undefined);
    }
  });

  test("webhook rejects expired channels and ignores replayed messages", async ({
    request,
  }) => {
    await prepareAppForSeedUser(request);
    const orgId = await getSeedWorkspaceId(request);
    const expired = await createWatchChannel(request, orgId, {
      expirationAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    const replayed = await createWatchChannel(request, orgId, {
      lastMessageNumber: 5,
    });

    try {
      const expiredResponse = await request.post("/api/calendar/webhook", {
        headers: {
          "X-Goog-Channel-ID": expired.channelId,
          "X-Goog-Channel-Token": expired.token,
          "X-Goog-Resource-ID": "resource-1",
          "X-Goog-Resource-State": "exists",
          "X-Goog-Message-Number": "2",
        },
      });
      expect(expiredResponse.status()).toBe(404);

      const replayedResponse = await request.post("/api/calendar/webhook", {
        headers: {
          "X-Goog-Channel-ID": replayed.channelId,
          "X-Goog-Channel-Token": replayed.token,
          "X-Goog-Resource-ID": "resource-1",
          "X-Goog-Resource-State": "exists",
          "X-Goog-Message-Number": "5",
        },
      });
      expect(replayedResponse.status()).toBe(204);

      const expiredRows = await rest(
        request,
        `google_calendar_watch_channels?id=eq.${expired.rowId}&select=status,last_resource_state,last_message_number`
      );
      expect(expiredRows[0].status).toBe("expired");
      expect(expiredRows[0].last_resource_state).toBeNull();
      expect(expiredRows[0].last_message_number).toBeNull();

      const replayedRows = await rest(
        request,
        `google_calendar_watch_channels?id=eq.${replayed.rowId}&select=status,last_resource_state,last_message_number`
      );
      expect(replayedRows[0].status).toBe("active");
      expect(replayedRows[0].last_resource_state).toBeNull();
      expect(replayedRows[0].last_message_number).toBe(5);
    } finally {
      await rest(request, `google_calendar_watch_channels?id=eq.${expired.rowId}`, {
        method: "DELETE",
      }).catch(() => undefined);
      await rest(request, `google_calendar_watch_channels?id=eq.${replayed.rowId}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
  });
});
