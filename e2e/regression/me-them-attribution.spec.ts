import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const HAS_TRANSCRIPTION = !!process.env.OPENROUTER_API_KEY;
const FIXTURES = path.resolve(__dirname, "../fixtures/me-them");

interface Segment {
  speaker: string;
  start: number;
  text: string;
}

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

const service = (extra: Record<string, string> = {}) => ({
  ...headers(SERVICE_KEY, extra),
  apikey: SERVICE_KEY,
});

async function upload(
  request: APIRequestContext,
  token: string,
  objectPath: string,
  fixture: string,
) {
  const response = await request.post(
    `${SUPABASE_URL}/storage/v1/object/meeting-audio/${objectPath}`,
    {
      headers: headers(token, {
        "Content-Type": "audio/mp4",
        "x-upsert": "true",
      }),
      data: readFileSync(path.join(FIXTURES, fixture)),
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function listMeetingAudio(request: APIRequestContext, meetingId: string) {
  const response = await request.post(
    `${SUPABASE_URL}/storage/v1/object/list/meeting-audio`,
    {
      headers: service({ "Content-Type": "application/json" }),
      data: { prefix: meetingId, limit: 100 },
    },
  );
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { name: string }[]).map((o) => o.name);
}

test.describe("Me versus Them attribution", () => {
  test("companion records both channels and the recap attributes my lines to me and theirs to Them in spoken order", async ({
    page,
    request,
  }) => {
    test.skip(
      !SERVICE_KEY,
      "Requires service role for isolated capture fixtures",
    );
    test.skip(!HAS_TRANSCRIPTION, "Requires a live transcription provider key");
    test.setTimeout(240_000);

    const { token, userId } = await signIn(request);
    const auth = headers(token, { "Content-Type": "application/json" });
    const profile = await request.get(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=name,current_organization_id`,
      {
        headers: auth,
      },
    );
    const [{ name: recorderName, current_organization_id: organizationId }] =
      await profile.json();
    expect(recorderName).toBeTruthy();

    const series = await request.post(
      `${SUPABASE_URL}/rest/v1/meeting_series?select=id`,
      {
        headers: { ...auth, Prefer: "return=representation" },
        data: {
          name: `Me Them ${Date.now()}`,
          cadence: "weekly",
          owner_id: userId,
          organization_id: organizationId,
        },
      },
    );
    expect(series.ok()).toBeTruthy();
    const seriesId = (await series.json())[0].id as string;
    let meetingId = "";

    try {
      const started = await request.post(
        `${SUPABASE_URL}/rest/v1/rpc/start_or_join_meeting`,
        {
          headers: auth,
          data: { target_series_id: seriesId },
        },
      );
      expect(started.ok()).toBeTruthy();
      meetingId = (await started.json()).id as string;

      const mePath = `${meetingId}/seg-0-me.m4a`;
      const themPath = `${meetingId}/seg-0-them.m4a`;
      await upload(request, token, mePath, "me.m4a");
      await upload(request, token, themPath, "them.m4a");

      const segment = await request.post(
        `/api/meetings/${meetingId}/segments/0/transcribe`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: { paths: { me: mePath, them: themPath }, offset_seconds: 0 },
          timeout: 120_000,
        },
      );
      expect(segment.status(), await segment.text()).toBe(200);

      const segRows = await request.get(
        `${SUPABASE_URL}/rest/v1/meeting_audio_segments?meeting_id=eq.${meetingId}&select=status,them_storage_path,transcript_segments`,
        { headers: service() },
      );
      const [segRow] = await segRows.json();
      expect(segRow.status).toBe("completed");
      expect(segRow.them_storage_path).toBe(themPath);
      expect(
        new Set(
          (segRow.transcript_segments as Segment[]).map((s) => s.speaker),
        ),
      ).toEqual(new Set(["me", "them"]));

      const recordingPath = `${meetingId}/recording.m4a`;
      await upload(request, token, recordingPath, "recording.m4a");
      const ended = await request.patch(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}`,
        {
          headers: { ...auth, Prefer: "return=minimal" },
          data: {
            status: "completed",
            completed_at: new Date().toISOString(),
            audio_file_path: recordingPath,
            audio_duration_seconds: 11,
            audio_file_size_bytes: readFileSync(
              path.join(FIXTURES, "recording.m4a"),
            ).length,
            transcription_status: "pending",
            transcription_outcome: null,
          },
        },
      );
      expect(ended.ok()).toBeTruthy();

      const final = await request.post(
        `/api/meetings/${meetingId}/transcribe`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: { expected_segments: 1 },
          timeout: 200_000,
        },
      );
      expect(final.status(), await final.text()).toBe(200);
      expect((await final.json()).audio_discarded).toBe(true);

      const stored = await request.get(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}&select=transcript_diarized,speaker_map,transcript_segments,transcript_raw,audio_file_path`,
        { headers: service() },
      );
      const [meeting] = await stored.json();
      expect(meeting.transcript_diarized).toBe(true);
      expect(meeting.speaker_map).toEqual({ me: recorderName, them: null });
      expect(meeting.audio_file_path).toBeNull();

      const segments = meeting.transcript_segments as Segment[];
      const firstThem = segments.findIndex((s) => s.speaker === "them");
      expect(firstThem).toBeGreaterThan(0);
      expect(segments.slice(0, firstThem).some((s) => s.speaker === "me")).toBe(
        true,
      );
      expect(
        segments.slice(firstThem + 1).some((s) => s.speaker === "me"),
      ).toBe(true);
      expect(segments.map((s) => s.start)).toEqual(
        [...segments.map((s) => s.start)].sort((a, b) => a - b),
      );
      expect(meeting.transcript_raw).toContain(`${recorderName}:`);
      expect(meeting.transcript_raw).toContain("Them:");

      expect(await listMeetingAudio(request, meetingId)).toEqual([]);

      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);
      await page.getByRole("button", { name: /Transcript/ }).click();

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
      await expect(turns.nth(0)).toContainText(/checklist/i);
      await expect(turns.nth(1)).toContainText(/migration/i);
      await expect(turns.nth(2)).toContainText(/summary/i);
    } finally {
      if (meetingId) {
        await request.delete(
          `${SUPABASE_URL}/storage/v1/object/meeting-audio`,
          {
            headers: service({ "Content-Type": "application/json" }),
            data: {
              prefixes: ["seg-0-me.m4a", "seg-0-them.m4a", "recording.m4a"].map(
                (name) => `${meetingId}/${name}`,
              ),
            },
          },
        );
      }
      await request.delete(
        `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${seriesId}`,
        { headers: service() },
      );
    }
  });
});
