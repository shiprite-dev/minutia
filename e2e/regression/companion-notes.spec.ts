import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const COMPANION_NOTES = [
  "Desk note: the migration checklist owns Friday.",
  "Desk note: ping Sam about the offer letter.",
].join("\n");

const WEB_NOTES = [
  "Web note: keep the launch scope small.",
  "Web note: the support queue is the top risk.",
].join("\n");

interface MeetingNotesRow {
  companion_notes_markdown: string;
  notes_markdown: string | null;
  raw_notes_markdown: string | null;
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

async function readNotes(request: APIRequestContext, meetingId: string) {
  const response = await request.get(
    `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}&select=companion_notes_markdown,notes_markdown,raw_notes_markdown`,
    { headers: service() },
  );
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as MeetingNotesRow[])[0];
}

test.describe("Companion notepad notes", () => {
  test("notes typed in the desktop companion show read-only under the web notes after the meeting ends", async ({
    page,
    request,
  }) => {
    test.skip(
      !SERVICE_KEY,
      "Requires service role for isolated fixtures and cleanup",
    );
    test.setTimeout(120_000);

    const { token, userId } = await signIn(request);
    const auth = headers(token, { "Content-Type": "application/json" });
    const profile = await request.get(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=current_organization_id`,
      { headers: auth },
    );
    expect(profile.ok()).toBeTruthy();
    const [{ current_organization_id: organizationId }] = await profile.json();

    const series = await request.post(
      `${SUPABASE_URL}/rest/v1/meeting_series?select=id`,
      {
        headers: { ...auth, Prefer: "return=representation" },
        data: {
          name: `Companion notes ${Date.now()}`,
          cadence: "weekly",
          owner_id: userId,
          organization_id: organizationId,
        },
      },
    );
    expect(series.ok()).toBeTruthy();
    const seriesId = (await series.json())[0].id as string;

    try {
      const started = await request.post(
        `${SUPABASE_URL}/rest/v1/rpc/start_or_join_meeting`,
        { headers: auth, data: { target_series_id: seriesId } },
      );
      expect(started.ok()).toBeTruthy();
      const meetingId = (await started.json()).id as string;

      const saved = await request.patch(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}`,
        {
          headers: { ...auth, Prefer: "return=minimal" },
          data: {
            companion_notes_markdown: COMPANION_NOTES,
            notes_markdown: WEB_NOTES,
            raw_notes_markdown: WEB_NOTES,
          },
        },
      );
      expect(saved.ok()).toBeTruthy();

      const ended = await request.patch(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}`,
        {
          headers: { ...auth, Prefer: "return=minimal" },
          data: { status: "completed", completed_at: new Date().toISOString() },
        },
      );
      expect(ended.ok()).toBeTruthy();

      const stored = await readNotes(request, meetingId);
      expect(stored.companion_notes_markdown).toBe(COMPANION_NOTES);
      expect(stored.notes_markdown).toBe(WEB_NOTES);
      expect(stored.raw_notes_markdown).toBe(WEB_NOTES);

      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);

      await expect(
        page
          .getByRole("heading", { name: "From your desktop notepad" })
          .first(),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page
          .getByText("Desk note: the migration checklist owns Friday.")
          .first(),
      ).toBeVisible();
      await expect(
        page.getByText("Desk note: ping Sam about the offer letter.").first(),
      ).toBeVisible();

      const webNotes = page.getByPlaceholder("Meeting notes...").first();
      await expect(webNotes).toBeVisible();
      await expect(webNotes).toHaveValue(WEB_NOTES);

      const rejected = await request.patch(
        `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meetingId}`,
        {
          headers: { ...auth, Prefer: "return=minimal" },
          data: { companion_notes_markdown: "x".repeat(100_001) },
        },
      );
      expect(rejected.status()).toBeGreaterThanOrEqual(400);
      expect(
        (await readNotes(request, meetingId)).companion_notes_markdown,
      ).toBe(COMPANION_NOTES);
    } finally {
      await request.delete(
        `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${seriesId}`,
        { headers: service() },
      );
    }
  });
});
