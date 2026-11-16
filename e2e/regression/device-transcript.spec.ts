import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

async function signIn(request: APIRequestContext) {
  const response = await request.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      data: { email: "test@example.com", password: "password123" },
    },
  );
  expect(response.ok()).toBeTruthy();
  const token = (await response.json()).access_token as string;
  const userId = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
  ).sub as string;
  return { token, userId };
}

function headers(key: string, extra: Record<string, string> = {}) {
  return { apikey: ANON_KEY, Authorization: `Bearer ${key}`, ...extra };
}

const deviceTranscript = {
  schema_version: 1,
  source: {
    kind: "device",
    engine: "fluidaudio",
    engine_version: "0.17.7",
    model: "parakeet-tdt-0.6b-v3-coreml",
    model_revision: "a0cd34f8",
    app_version: "0.4.0",
    compute: "ane",
  },
  language: "en",
  duration_seconds: 12.5,
  outcome: "speech",
  segments: [
    {
      speaker: "them",
      start: 3.4,
      end: 7.9,
      text: "The vendor migration is still blocked on legal.",
      confidence: 0.9,
    },
    {
      speaker: "me",
      start: 0.4,
      end: 3.1,
      text: "Let us start with the release checklist.",
      confidence: 0.93,
    },
    {
      speaker: "me",
      start: 3.48,
      end: 7.98,
      text: "The vendor migration is still blocked on legal.",
      confidence: 0.4,
    },
    {
      speaker: "me",
      start: 8.2,
      end: 11.6,
      text: "I will send the summary to everyone today.",
      confidence: 0.95,
    },
  ],
};

test.describe("On-device transcript submission", () => {
  test("the companion submits a finished device transcript and the meeting shows it attributed to Me and Them, and a resubmit replays", async ({
    page,
    request,
  }) => {
    const { token, userId } = await signIn(request);
    const auth = headers(token, { "Content-Type": "application/json" });
    const profile = await request.get(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=name,current_organization_id`,
      { headers: auth },
    );
    const [{ name: recorderName, current_organization_id: organizationId }] =
      await profile.json();
    expect(recorderName).toBeTruthy();

    const series = await request.post(
      `${SUPABASE_URL}/rest/v1/meeting_series?select=id`,
      {
        headers: { ...auth, Prefer: "return=representation" },
        data: {
          name: `Device Transcript ${Date.now()}`,
          cadence: "weekly",
          owner_id: userId,
          organization_id: organizationId,
        },
      },
    );
    expect(series.ok(), await series.text()).toBeTruthy();
    const seriesId = (await series.json())[0].id as string;

    try {
      const started = await request.post(
        `${SUPABASE_URL}/rest/v1/rpc/start_or_join_meeting`,
        { headers: auth, data: { target_series_id: seriesId } },
      );
      expect(started.ok(), await started.text()).toBeTruthy();
      const meetingId = (await started.json()).id as string;

      const ended = await request.patch(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}`,
        {
          headers: { ...auth, Prefer: "return=minimal" },
          data: {
            status: "completed",
            completed_at: new Date().toISOString(),
            audio_duration_seconds: 13,
            transcription_status: "pending",
            transcription_outcome: null,
          },
        },
      );
      expect(ended.ok(), await ended.text()).toBeTruthy();

      const submitted = await request.post(
        `/api/meetings/${meetingId}/transcript`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: deviceTranscript,
        },
      );
      expect(submitted.status(), await submitted.text()).toBe(200);
      const result = await submitted.json();
      expect(result.status).toBe("completed");
      expect(result.provider).toBe("device");
      expect(result.outcome).toBe("speech");
      expect(result.segments).toBe(3);
      expect(result.replay).not.toBe(true);

      const stored = await request.get(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}&select=transcription_status,transcription_provider,transcription_model,transcription_outcome,transcript_diarized,speaker_map,transcript_segments,transcript_raw,transcript_language,transcription_source,audio_duration_seconds`,
        { headers: auth },
      );
      expect(stored.ok(), await stored.text()).toBeTruthy();
      const [meeting] = await stored.json();
      expect(meeting.transcription_status).toBe("completed");
      expect(meeting.transcription_provider).toBe("device");
      expect(meeting.transcription_model).toBe("parakeet-tdt-0.6b-v3-coreml");
      expect(meeting.transcription_outcome).toBe("speech");
      expect(meeting.transcript_diarized).toBe(true);
      expect(meeting.speaker_map).toEqual({ me: recorderName, them: null });
      expect(meeting.transcript_language).toBe("en");
      expect(meeting.transcription_source).toEqual(deviceTranscript.source);
      expect(meeting.audio_duration_seconds).toBe(13);
      expect(
        (meeting.transcript_segments as { speaker: string }[]).map(
          (s) => s.speaker,
        ),
      ).toEqual(["me", "them", "me"]);
      expect(meeting.transcript_raw).toBe(
        [
          `${recorderName}: Let us start with the release checklist.`,
          "Them: The vendor migration is still blocked on legal.",
          `${recorderName}: I will send the summary to everyone today.`,
        ].join("\n"),
      );

      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);
      await page
        .getByRole("button", { name: /Transcript/ })
        .first()
        .click();

      const turns = page.locator("li").filter({
        has: page.getByRole("button", { name: /^Rename (Me|Them),/ }),
      });
      await expect(turns.first()).toBeVisible({ timeout: 20_000 });
      await expect(
        page
          .getByRole("button", { name: `Rename Me, currently ${recorderName}` })
          .first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Rename Them, currently Them" }),
      ).toHaveCount(1);
      const labels = await turns.evaluateAll((items) =>
        items.map(
          (li) =>
            (
              li.querySelector("button")?.getAttribute("aria-label") ?? ""
            ).split(",")[0],
        ),
      );
      expect(labels).toEqual(["Rename Me", "Rename Them", "Rename Me"]);
      await expect(turns.nth(0)).toContainText(/release checklist/i);
      await expect(turns.nth(1)).toContainText(/vendor migration/i);
      await expect(turns.nth(2)).toContainText(/summary/i);
      await expect(
        page.getByText("Transcribed on device · parakeet-tdt-0.6b-v3-coreml"),
      ).toBeVisible();

      const replayed = await request.post(
        `/api/meetings/${meetingId}/transcript`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: deviceTranscript,
        },
      );
      expect(replayed.status(), await replayed.text()).toBe(200);
      const replay = await replayed.json();
      expect(replay.replay).toBe(true);
      expect(replay.status).toBe("completed");

      const after = await request.get(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}&select=transcript_raw,transcription_status`,
        { headers: auth },
      );
      const [unchanged] = await after.json();
      expect(unchanged.transcription_status).toBe("completed");
      expect(unchanged.transcript_raw).toBe(meeting.transcript_raw);

      const correction = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/meetings/${meetingId}/speaker-map`) &&
          r.request().method() === "PATCH",
      );
      await page
        .getByRole("button", { name: "Rename Them, currently Them" })
        .click();
      await page.getByLabel("Name for Them").fill("Dana Reyes");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Save" })
        .click();
      expect((await correction).status()).toBe(200);
      await expect(
        page.getByRole("button", { name: "Rename Them, currently Dana Reyes" }),
      ).toBeVisible();
      const correctedRow = await request.get(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}&select=speaker_map,transcript_raw`,
        { headers: auth },
      );
      const [corrected] = await correctedRow.json();
      expect(corrected.speaker_map).toEqual({
        me: recorderName,
        them: "Dana Reyes",
      });
      expect(corrected.transcript_raw).toContain(
        "Dana Reyes: The vendor migration is still blocked on legal.",
      );
    } finally {
      await request.delete(
        `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${seriesId}`,
        {
          headers: SERVICE_KEY
            ? { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
            : headers(token),
        },
      );
    }
  });

  test("a meeting the companion is still transcribing waits for the device without calling the audio route, then shows the device transcript when it lands", async ({
    page,
    request,
  }) => {
    const { token, userId } = await signIn(request);
    const auth = headers(token, { "Content-Type": "application/json" });
    const profile = await request.get(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=current_organization_id`,
      { headers: auth },
    );
    const [{ current_organization_id: organizationId }] = await profile.json();

    const series = await request.post(
      `${SUPABASE_URL}/rest/v1/meeting_series?select=id`,
      {
        headers: { ...auth, Prefer: "return=representation" },
        data: {
          name: `Device Waiting ${Date.now()}`,
          cadence: "weekly",
          owner_id: userId,
          organization_id: organizationId,
        },
      },
    );
    expect(series.ok(), await series.text()).toBeTruthy();
    const seriesId = (await series.json())[0].id as string;

    try {
      const started = await request.post(
        `${SUPABASE_URL}/rest/v1/rpc/start_or_join_meeting`,
        { headers: auth, data: { target_series_id: seriesId } },
      );
      expect(started.ok(), await started.text()).toBeTruthy();
      const meetingId = (await started.json()).id as string;

      const ended = await request.patch(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}`,
        {
          headers: { ...auth, Prefer: "return=minimal" },
          data: {
            status: "completed",
            completed_at: new Date().toISOString(),
            audio_file_path: null,
            transcription_provider: "device",
            transcription_status: "pending",
            transcription_outcome: null,
          },
        },
      );
      expect(ended.ok(), await ended.text()).toBeTruthy();

      const transcribeCalls: string[] = [];
      page.on("request", (req) => {
        if (/\/api\/meetings\/[^/]+\/transcribe(\?|$)/.test(req.url()))
          transcribeCalls.push(req.url());
      });

      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);

      const status = page.getByRole("region", { name: "Transcription status" });
      await expect(
        status.getByText(
          "Waiting for the transcript from the recording device.",
        ),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole("button", { name: "Retry transcription" }),
      ).toHaveCount(0);
      await expect(page.getByText("Transcribed on device")).toHaveCount(0);

      const submitted = await request.post(
        `/api/meetings/${meetingId}/transcript`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: deviceTranscript,
        },
      );
      expect(submitted.status(), await submitted.text()).toBe(200);

      await expect(
        page.getByText("Transcribed on device · parakeet-tdt-0.6b-v3-coreml"),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByText("Waiting for the transcript from the recording device."),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: /Transcript/ })
        .first()
        .click();
      await expect(
        page.getByRole("button", { name: "Rename Them, currently Them" }),
      ).toHaveCount(1);
      expect(transcribeCalls).toEqual([]);
    } finally {
      await request.delete(
        `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${seriesId}`,
        {
          headers: SERVICE_KEY
            ? { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
            : headers(token),
        },
      );
    }
  });

  for (const transcriptionStatus of ["pending", "failed", "processing"] as const) {
    test(`a device meeting left ${transcriptionStatus} with no audio for over the grace period stops waiting and never offers an audio retry`, async ({
      page,
      request,
    }) => {
      const { token, userId } = await signIn(request);
      const auth = headers(token, { "Content-Type": "application/json" });
      const profile = await request.get(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=current_organization_id`,
        { headers: auth },
      );
      const [{ current_organization_id: organizationId }] = await profile.json();
      const series = await request.post(
        `${SUPABASE_URL}/rest/v1/meeting_series?select=id`,
        {
          headers: { ...auth, Prefer: "return=representation" },
          data: {
            name: `Device Overdue ${transcriptionStatus} ${Date.now()}`,
            cadence: "weekly",
            owner_id: userId,
            organization_id: organizationId,
          },
        },
      );
      expect(series.ok(), await series.text()).toBeTruthy();
      const seriesId = (await series.json())[0].id as string;

      try {
        const started = await request.post(
          `${SUPABASE_URL}/rest/v1/rpc/start_or_join_meeting`,
          { headers: auth, data: { target_series_id: seriesId } },
        );
        expect(started.ok(), await started.text()).toBeTruthy();
        const meetingId = (await started.json()).id as string;
        const ended = await request.patch(
          `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}`,
          {
            headers: { ...auth, Prefer: "return=minimal" },
            data: {
              status: "completed",
              completed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
              audio_file_path: null,
              transcription_provider: "device",
              transcription_status: transcriptionStatus,
              transcription_outcome: null,
              transcription_started_at:
                transcriptionStatus === "processing"
                  ? new Date(Date.now() - 60 * 60 * 1000).toISOString()
                  : null,
            },
          },
        );
        expect(ended.ok(), await ended.text()).toBeTruthy();

        const transcribeCalls: string[] = [];
        page.on("request", (req) => {
          if (/\/api\/meetings\/[^/]+\/transcribe(\?|$)/.test(req.url()))
            transcribeCalls.push(req.url());
        });

        await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
        await waitForApp(page);

        const status = page.getByRole("region", { name: "Transcription status" });
        await expect(
          status.getByText(
            "Still waiting for the transcript from the recording device.",
          ),
        ).toBeVisible({ timeout: 20_000 });
        await expect(
          page.getByRole("button", { name: "Retry transcription" }),
        ).toHaveCount(0);
        await expect(page.getByText("Transcription did not finish.")).toHaveCount(0);
        await expect(page.getByText("Transcription is taking longer than expected.")).toHaveCount(0);

        const submitted = await request.post(
          `/api/meetings/${meetingId}/transcript`,
          {
            headers: { Authorization: `Bearer ${token}` },
            data: deviceTranscript,
          },
        );
        expect(submitted.status(), await submitted.text()).toBe(200);
        await expect(
          page.getByText("Transcribed on device · parakeet-tdt-0.6b-v3-coreml").first(),
        ).toBeVisible({ timeout: 20_000 });
        expect(transcribeCalls).toEqual([]);
      } finally {
        await request.delete(
          `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${seriesId}`,
          {
            headers: SERVICE_KEY
              ? { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
              : headers(token),
          },
        );
      }
    });
  }

  test("an open meeting page stops waiting for the device once the grace period passes, without a reload", async ({
    page,
    request,
  }) => {
    const { token, userId } = await signIn(request);
    const auth = headers(token, { "Content-Type": "application/json" });
    const profile = await request.get(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=current_organization_id`,
      { headers: auth },
    );
    const [{ current_organization_id: organizationId }] = await profile.json();
    const series = await request.post(
      `${SUPABASE_URL}/rest/v1/meeting_series?select=id`,
      {
        headers: { ...auth, Prefer: "return=representation" },
        data: {
          name: `Device Grace ${Date.now()}`,
          cadence: "weekly",
          owner_id: userId,
          organization_id: organizationId,
        },
      },
    );
    expect(series.ok(), await series.text()).toBeTruthy();
    const seriesId = (await series.json())[0].id as string;

    try {
      const started = await request.post(
        `${SUPABASE_URL}/rest/v1/rpc/start_or_join_meeting`,
        { headers: auth, data: { target_series_id: seriesId } },
      );
      expect(started.ok(), await started.text()).toBeTruthy();
      const meetingId = (await started.json()).id as string;
      const ended = await request.patch(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}`,
        {
          headers: { ...auth, Prefer: "return=minimal" },
          data: {
            status: "completed",
            completed_at: new Date().toISOString(),
            audio_file_path: null,
            transcription_provider: "device",
            transcription_status: "pending",
            transcription_outcome: null,
          },
        },
      );
      expect(ended.ok(), await ended.text()).toBeTruthy();

      await page.clock.install();
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);

      const status = page.getByRole("region", { name: "Transcription status" });
      await expect(
        status.getByText("Waiting for the transcript from the recording device."),
      ).toBeVisible({ timeout: 20_000 });

      await page.clock.fastForward("16:00");

      await expect(
        status.getByText("Still waiting for the transcript from the recording device."),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole("button", { name: "Retry transcription" }),
      ).toHaveCount(0);
    } finally {
      await request.delete(
        `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${seriesId}`,
        {
          headers: SERVICE_KEY
            ? { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
            : headers(token),
        },
      );
    }
  });

  test("a submission without a session is refused and changes nothing", async ({
    playwright,
  }) => {
    const anonymous = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const response = await anonymous.post(
        "/api/meetings/00000000-0000-0000-0000-000000000000/transcript",
        { data: deviceTranscript },
      );
      expect(response.status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  });
});
