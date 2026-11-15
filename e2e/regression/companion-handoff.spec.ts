import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe.configure({ mode: "default" });

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEVICE = { device_id: randomUUID(), device_name: "Studio Mac" };
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const INSTALL_COPY =
  "For the best experience, download and install the companion app.";

function serviceHeaders(prefer = "return=representation") {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function rest(
  request: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {},
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers ?? {}) },
  });
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

async function userToken(request: APIRequestContext) {
  const response = await request.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      data: { email: "test@example.com", password: "password123" },
    },
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()).access_token as string;
}

function companion(request: APIRequestContext, token: string) {
  const post = async (path: string, data: Record<string, unknown>) => {
    const response = await request.post(path, {
      headers: { Authorization: `Bearer ${token}` },
      data,
    });
    expect(response.ok(), `${path} ${response.status()}`).toBeTruthy();
    return response.json();
  };
  return {
    checkin: (can_claim: boolean, device = DEVICE) =>
      post("/api/companion/checkin", { ...device, can_claim }),
    event: (
      meeting_id: string,
      event: "started" | "failed" | "stopped",
      device = DEVICE,
      reason?: string,
    ) =>
      post("/api/companion/recording", {
        meeting_id,
        ...device,
        event,
        ...(reason ? { reason } : {}),
      }),
  };
}

async function setLastSeen(request: APIRequestContext, value: string | null) {
  await rest(request, `profiles?id=eq.${TEST_USER_ID}`, {
    method: "PATCH",
    headers: serviceHeaders("return=minimal"),
    data: { companion_last_seen_at: value },
  });
}

async function createSeries(
  request: APIRequestContext,
  meeting: { status: "upcoming" | "live" } | null,
) {
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  await rest(request, "meeting_series", {
    method: "POST",
    headers: serviceHeaders("return=minimal"),
    data: {
      id: seriesId,
      name: `Companion handoff ${Date.now()}`,
      cadence: "weekly",
      owner_id: TEST_USER_ID,
    },
  });
  if (meeting) {
    await rest(request, "meetings", {
      method: "POST",
      headers: serviceHeaders("return=minimal"),
      data: {
        id: meetingId,
        series_id: seriesId,
        sequence_number: 1,
        title: `Handoff ${Date.now()}`,
        status: meeting.status,
      },
    });
  }
  return { seriesId, meetingId };
}

async function readMeeting(request: APIRequestContext, meetingId: string) {
  const rows = await rest(
    request,
    `meetings?id=eq.${meetingId}&select=status,record_requested_at,record_requested_by,recording_user_id,recording_device_name,recording_started_at,recording_failed_reason`,
  );
  return rows[0] as Record<string, string | null>;
}

async function liveMeetingId(request: APIRequestContext, seriesId: string) {
  const rows = await rest(
    request,
    `meetings?series_id=eq.${seriesId}&status=eq.live&select=id`,
  );
  return (rows[0]?.id as string) ?? "";
}

async function asMacBrowser(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      get: () => ({ platform: "macOS" }),
    });
  });
}

async function cleanup(request: APIRequestContext, seriesId: string) {
  await setLastSeen(request, null);
  await rest(request, `meeting_series?id=eq.${seriesId}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

test.describe("Starting on the web records on the Mac", () => {
  test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated fixtures");
  test.use({ userAgent: MAC_UA });

  test("starting from the series page asks the Mac, and the page follows it from starting to recording to stopped", async ({
    page,
    request,
  }) => {
    const { seriesId } = await createSeries(request, null);
    const token = await userToken(request);
    const mac = companion(request, token);
    try {
      await mac.checkin(false);
      await asMacBrowser(page);
      await page.goto(`/series/${seriesId}`);
      await waitForApp(page);
      await page.getByRole("button", { name: "Start meeting" }).click();
      await expect(page.getByText("Starting on your Mac…")).toBeVisible({
        timeout: 15_000,
      });
      const meetingId = await liveMeetingId(request, seriesId);
      expect((await readMeeting(request, meetingId)).record_requested_by).toBe(
        TEST_USER_ID,
      );

      const claimed = await mac.checkin(true);
      expect(claimed.claim?.meeting_id).toBe(meetingId);
      expect(claimed.claim?.series_id).toBe(seriesId);
      expect((await mac.checkin(true)).claim).toBeNull();

      expect((await mac.event(meetingId, "started")).result).toBe("ok");
      await expect(page.getByText("Recording on Studio Mac")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByRole("button", { name: "Record meeting audio" }),
      ).toHaveCount(0);

      expect((await mac.event(meetingId, "stopped")).result).toBe("ok");
      await expect(page.getByText("Recording on Studio Mac")).toHaveCount(0, {
        timeout: 10_000,
      });
      const row = await readMeeting(request, meetingId);
      expect(row.recording_user_id).toBeNull();
      expect(row.recording_started_at).toBeNull();
    } finally {
      await cleanup(request, seriesId);
    }
  });

  test("starting an upcoming meeting from its page asks the Mac too", async ({
    page,
    request,
  }) => {
    const { seriesId, meetingId } = await createSeries(request, {
      status: "upcoming",
    });
    const token = await userToken(request);
    try {
      await companion(request, token).checkin(false);
      await asMacBrowser(page);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);
      await page.getByRole("button", { name: "Start meeting" }).click();
      await expect(page.getByText("Starting on your Mac…")).toBeVisible({
        timeout: 15_000,
      });
      const live = await liveMeetingId(request, seriesId);
      expect((await readMeeting(request, live)).record_requested_by).toBe(
        TEST_USER_ID,
      );
    } finally {
      await cleanup(request, seriesId);
    }
  });

  test("a Mac that cannot start hands recording back to the browser", async ({
    page,
    request,
  }) => {
    const { seriesId, meetingId } = await createSeries(request, {
      status: "live",
    });
    const token = await userToken(request);
    const mac = companion(request, token);
    try {
      await mac.checkin(false);
      await asMacBrowser(page);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);
      await page.getByRole("button", { name: "Record on your Mac" }).click();
      await expect(page.getByText("Starting on your Mac…")).toBeVisible();
      expect((await mac.checkin(true)).claim?.meeting_id).toBe(meetingId);

      await mac.event(meetingId, "failed", DEVICE, "mic_denied");
      await expect(page.getByText("Couldn't start on your Mac.")).toBeVisible({
        timeout: 10_000,
      });
      await page.getByRole("button", { name: "Record here instead" }).click();
      await expect(page.getByText("Couldn't start on your Mac.")).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: "Record meeting audio" }),
      ).toBeVisible();
    } finally {
      await cleanup(request, seriesId);
    }
  });

  test("a Mac seen before but asleep is offered to open, and opening it asks again", async ({
    page,
    request,
  }) => {
    const { seriesId, meetingId } = await createSeries(request, {
      status: "live",
    });
    try {
      await setLastSeen(
        request,
        new Date(Date.now() - 10 * 60_000).toISOString(),
      );
      await asMacBrowser(page);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);
      const open = page.getByRole("link", { name: "Open Minutia on your Mac" });
      await expect(open).toHaveAttribute("href", "minutia://open");
      await expect(page.getByText(INSTALL_COPY)).toHaveCount(0);
      await open.evaluate((a) =>
        a.addEventListener("click", (e) => e.preventDefault()),
      );
      await open.click();
      await expect
        .poll(
          async () =>
            (await readMeeting(request, meetingId)).record_requested_by,
        )
        .toBe(TEST_USER_ID);
    } finally {
      await cleanup(request, seriesId);
    }
  });

  test("the install prompt shows only on a Mac that has never connected, and a check-in removes it", async ({
    page,
    request,
  }) => {
    const { seriesId, meetingId } = await createSeries(request, {
      status: "live",
    });
    try {
      await setLastSeen(request, null);
      await asMacBrowser(page);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);
      await expect(page.getByText(INSTALL_COPY)).toBeVisible();

      await companion(request, await userToken(request)).checkin(false);
      await page.reload();
      await waitForApp(page);
      await expect(page.getByText("Live").first()).toBeVisible();
      await expect(page.getByText(INSTALL_COPY)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Record on your Mac" }),
      ).toBeVisible();
    } finally {
      await cleanup(request, seriesId);
    }
  });
});

test.describe("A browser that is not on a Mac", () => {
  test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated fixtures");
  test.use({ userAgent: LINUX_UA });

  test("never sees the install prompt and keeps browser recording", async ({
    page,
    request,
  }) => {
    const { seriesId, meetingId } = await createSeries(request, {
      status: "live",
    });
    try {
      await setLastSeen(request, null);
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgentData", {
          configurable: true,
          get: () => ({ platform: "Linux" }),
        });
      });
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);
      await expect(page.getByText("Live").first()).toBeVisible();
      await expect(page.getByText(INSTALL_COPY)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Record meeting audio" }),
      ).toBeVisible();
    } finally {
      await cleanup(request, seriesId);
    }
  });
});

test.describe("The server keeps one recorder per meeting", () => {
  test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated fixtures");

  test("claims need a present Mac and a fresh request, a second Mac is refused, and only the recorder can stop it", async ({
    request,
  }) => {
    const { seriesId, meetingId } = await createSeries(request, {
      status: "live",
    });
    const token = await userToken(request);
    const mac = companion(request, token);
    const other = { device_id: randomUUID(), device_name: "Laptop" };
    try {
      const requested = await request.post(
        `${SUPABASE_URL}/rest/v1/rpc/request_companion_record`,
        {
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          data: { p_meeting_id: meetingId },
        },
      );
      expect(requested.ok()).toBeTruthy();
      expect(await requested.json()).toBe("requested");

      expect((await mac.checkin(false)).claim).toBeNull();

      await rest(request, `meetings?id=eq.${meetingId}`, {
        method: "PATCH",
        headers: serviceHeaders("return=minimal"),
        data: {
          record_requested_at: new Date(Date.now() - 3 * 60_000).toISOString(),
        },
      });
      expect((await mac.checkin(true)).claim).toBeNull();

      expect((await mac.event(meetingId, "started")).result).toBe("ok");
      expect((await mac.event(meetingId, "started", other)).result).toBe(
        "conflict",
      );
      expect((await mac.event(meetingId, "stopped", other)).result).toBe(
        "ignored",
      );
      expect(
        (await readMeeting(request, meetingId)).recording_device_name,
      ).toBe("Studio Mac");

      const spoof = await request.fetch(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}`,
        {
          method: "PATCH",
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          data: { recording_device_name: "Spoofed", recording_user_id: null },
        },
      );
      expect(spoof.ok()).toBeTruthy();
      expect(
        (await readMeeting(request, meetingId)).recording_device_name,
      ).toBe("Studio Mac");

      expect((await mac.event(meetingId, "stopped")).result).toBe("ok");
    } finally {
      await cleanup(request, seriesId);
    }
  });
});
