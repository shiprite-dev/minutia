import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { SERIES, waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_OPENROUTER_KEY = !!process.env.OPENROUTER_API_KEY;
const EXPECTED_MODEL =
  process.env.OPENROUTER_MODEL || process.env.AI_MODEL || "google/gemini-3.1-flash-lite";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

function serviceHeaders(prefer = "return=representation") {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this test");
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
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...serviceHeaders(),
      ...(options.headers ?? {}),
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function deleteSeries(request: APIRequestContext, id: string) {
  await rest(request, `meeting_series?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

async function createAiNotesFixture(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  const rawNotes = [
    `AI notes raw capture ${stamp}`,
    "Alice owns the onboarding checklist by Friday.",
    "Decision: keep the launch scope small.",
    "Risk: support queue may spike after launch."
  ].join("\n");

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `AI notes coverage ${stamp}`,
      description: "Created by AI notes functional coverage.",
      cadence: "weekly",
      default_attendees: ["Alice", "Bob"],
      owner_id: TEST_USER_ID,
    },
  });

  await rest(request, "meetings", {
    method: "POST",
    data: {
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: `AI notes session ${stamp}`,
      date: "2026-06-04",
      attendees: ["Alice", "Bob"],
      status: "completed",
      notes_markdown: rawNotes,
      raw_notes_markdown: rawNotes,
      transcript_raw: null,
      completed_at: new Date().toISOString(),
    },
  });

  return { seriesId, meetingId, rawNotes };
}

test.describe("AI notes", () => {
  test("returns 503 from the real endpoint when OpenRouter is not configured", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated AI notes data");
    test.skip(HAS_OPENROUTER_KEY, "Requires OpenRouter to be unconfigured");

    const fixture = await createAiNotesFixture(request);

    try {
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);

      const response = await page.request.post(
        `/api/meetings/${fixture.meetingId}/enhance-notes`,
        { data: { mode: "preview" }, timeout: 20_000 }
      );
      expect(response.status()).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: "AI notes are not configured.",
      });
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("generates notes through the authenticated backend route with OpenRouter", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated AI notes data");
    test.skip(!HAS_OPENROUTER_KEY, "Requires OpenRouter for backend AI notes coverage");

    const fixture = await createAiNotesFixture(request);

    try {
      const response = await page.request.post(
        `/api/meetings/${fixture.meetingId}/enhance-notes`,
        { data: { mode: "preview" }, timeout: 60_000 }
      );
      expect(response.status()).toBe(200);

      const payload = await response.json();
      expect(payload).toMatchObject({
        model: EXPECTED_MODEL,
        prompt_version: "ai-notes-v1",
      });
      expect(payload.ai_notes_markdown).toContain("##");
      expect(
        Object.values(payload.ai_notes).some(
          (items) => Array.isArray(items) && items.length > 0
        )
      ).toBe(true);

      const rows = await rest(
        request,
        `meetings?id=eq.${fixture.meetingId}&select=notes_markdown,raw_notes_markdown,ai_notes_markdown,ai_notes_model,ai_notes_prompt_version`
      );
      expect(rows[0]).toMatchObject({
        notes_markdown: fixture.rawNotes,
        raw_notes_markdown: fixture.rawNotes,
        ai_notes_model: EXPECTED_MODEL,
        ai_notes_prompt_version: "ai-notes-v1",
      });
      expect(rows[0].ai_notes_markdown).toContain("##");
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("preserves raw notes and applies generated notes after preview", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated AI notes data");

    const fixture = await createAiNotesFixture(request);

    try {
      await page.route("**/api/meetings/*/enhance-notes", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ai_notes: {
              summary: [
                "The team kept launch scope small and identified a support queue risk."
              ],
              action_items: ["Alice owns the onboarding checklist by Friday."],
              decisions: ["Keep the launch scope small."],
              risks: ["Support queue may spike after launch."],
              blockers: [],
              follow_ups: [],
              open_questions: [],
            },
            ai_notes_markdown: [
              "## Summary",
              "The team kept launch scope small and identified a support queue risk.",
              "",
              "## Action Items",
              "- Alice owns the onboarding checklist by Friday.",
              "",
              "## Decisions",
              "- Keep the launch scope small.",
              "",
              "## Risks",
              "- Support queue may spike after launch."
            ].join("\n"),
            model: EXPECTED_MODEL,
            prompt_version: "ai-notes-v1",
            generated_at: "2026-06-04T00:00:00.000Z",
          }),
        });
      });

      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);

      await expect(page.getByRole("heading", { name: /AI notes session/ })).toBeVisible();
      await expect(page.getByPlaceholder("Meeting notes...")).toHaveValue(fixture.rawNotes);

      await page.getByRole("button", { name: "Enhance notes" }).click();
      await expect(page.getByRole("dialog", { name: "AI notes preview" })).toBeVisible();
      const dialog = page.getByRole("dialog", { name: "AI notes preview" });
      await expect(dialog.getByRole("heading", { name: "Raw notes" })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Summary" })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Action items" })).toBeVisible();
      await expect(dialog.getByText("The team kept launch scope small")).toBeVisible();
      await expect(
        dialog.getByRole("listitem").filter({
          hasText: "Alice owns the onboarding checklist by Friday.",
        })
      ).toBeVisible();
      await expect(dialog.getByText("## Summary")).toHaveCount(0);

      await page.getByRole("button", { name: "Apply AI notes" }).click();
      await expect(page.getByRole("dialog", { name: "AI notes preview" })).toBeHidden();
      await expect(page.getByPlaceholder("Meeting notes...")).toHaveValue(/## Summary/);

      const rows = await rest(
        request,
        `meetings?id=eq.${fixture.meetingId}&select=notes_markdown,raw_notes_markdown,ai_notes_markdown,ai_notes_model,ai_notes_prompt_version`
      );
      expect(rows[0]).toMatchObject({
        raw_notes_markdown: fixture.rawNotes,
        ai_notes_model: EXPECTED_MODEL,
        ai_notes_prompt_version: "ai-notes-v1",
      });
      expect(rows[0].notes_markdown).toContain("## Summary");
      expect(rows[0].ai_notes_markdown).toContain("## Summary");
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("shows a disabled AI state when OpenRouter is not configured", async ({
    page,
    request,
  }) => {
    test.setTimeout(45_000);
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated AI notes data");
    test.skip(HAS_OPENROUTER_KEY, "Requires OpenRouter to be unconfigured");

    const fixture = await createAiNotesFixture(request);

    try {
      await page.route("**/api/meetings/*/enhance-notes", async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "AI notes are not configured." }),
        });
      });

      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);

      await expect(page.getByRole("heading", { name: /AI notes session/ })).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Enhance notes" }).click();
      await expect(page.getByText("AI notes are not configured.")).toBeVisible();
      await expect(page.getByPlaceholder("Meeting notes...")).toHaveValue(fixture.rawNotes);
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("shows an empty suggestions state", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated AI notes data");

    const fixture = await createAiNotesFixture(request);

    try {
      await page.route("**/api/meetings/*/suggestions", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ suggestions: [] }),
        });
      });

      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);
      await expect(page.getByRole("heading", { name: /AI notes session/ })).toBeVisible({ timeout: 20_000 });

      await page.getByRole("button", { name: "Review AI suggestions" }).click();
      await expect(page.getByRole("region", { name: "AI suggestions" })).toBeVisible();
      await expect(page.getByText("No AI suggestions yet.")).toBeVisible();
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });
});

test.describe("Ask this series", () => {
  test("returns 503 from Ask this series when OpenRouter is not configured", async ({
    page,
  }) => {
    test.skip(HAS_OPENROUTER_KEY, "Requires OpenRouter to be unconfigured");

    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    const response = await page.request.post(
      `/api/series/${SERIES.platformStandup}/ask`,
      { data: { question: "What did we decide about CI/CD?" }, timeout: 20_000 }
    );
    expect(response.status()).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Ask this series is not configured.",
    });
  });

  test("shows unsupported answers without citations", async ({ page }) => {
    await page.route("**/api/series/*/ask", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: "The source context does not prove the answer.",
          citations: [],
          unsupported: true,
        }),
      });
    });

    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    await page.getByLabel("Ask this series question").fill("What was the enterprise pricing decision?");
    await page.getByRole("button", { name: "Ask series" }).click();

    const answer = page.getByRole("region", { name: "Series answer" });
    await expect(answer).toBeVisible();
    await expect(answer.getByText("The source context does not prove the answer.")).toBeVisible();
    await expect(answer.getByText("Sources")).toBeHidden();
  });
});

test.describe("AI notes API auth", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("rejects unauthenticated enhancement before checking provider config", async ({
    request,
  }) => {
    const response = await request.post(
      `/api/meetings/${randomUUID()}/enhance-notes`,
      { data: { mode: "preview" } }
    );
    expect(response.status()).toBe(401);
  });

  test("rejects unauthenticated Ask this series before checking provider config", async ({
    request,
  }) => {
    const response = await request.post(
      `/api/series/${randomUUID()}/ask`,
      { data: { question: "What changed?" } }
    );
    expect(response.status()).toBe(401);
  });
});

test.describe("Transcript paste", () => {
  test("saves a pasted transcript to the meeting", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated transcript data");

    const fixture = await createAiNotesFixture(request);
    const transcript = `Alice: ship Friday. Bob: flag the support risk. ${Date.now()}`;

    try {
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);
      await expect(page.getByRole("heading", { name: /AI notes session/ })).toBeVisible({
        timeout: 20_000,
      });

      await page.getByRole("button", { name: "Transcript" }).click();
      await page.getByPlaceholder("Paste transcript...").fill(transcript);

      await expect(async () => {
        const rows = await rest(
          request,
          `meetings?id=eq.${fixture.meetingId}&select=transcript_raw`
        );
        expect(rows[0]?.transcript_raw).toBe(transcript);
      }).toPass({ timeout: 10_000 });
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("enables enhancement from a transcript alone", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role setup for isolated transcript data");

    const fixture = await createAiNotesFixture(request);

    try {
      // Strip notes so only a transcript remains.
      await rest(request, `meetings?id=eq.${fixture.meetingId}`, {
        method: "PATCH",
        headers: serviceHeaders("return=minimal"),
        data: {
          notes_markdown: "",
          raw_notes_markdown: "",
          transcript_raw: "Alice owns onboarding by Friday.",
        },
      });

      await page.route("**/api/meetings/*/enhance-notes", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ai_notes: {
              summary: ["Onboarding owned by Alice."],
              action_items: [],
              decisions: [],
              risks: [],
              blockers: [],
              follow_ups: [],
              open_questions: [],
            },
            ai_notes_markdown: "## Summary\nOnboarding owned by Alice.",
            model: "test-model",
            prompt_version: "ai-notes-v1",
            generated_at: "2026-06-04T00:00:00.000Z",
          }),
        });
      });

      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);
      await expect(page.getByRole("heading", { name: /AI notes session/ })).toBeVisible({
        timeout: 20_000,
      });

      const enhance = page.getByRole("button", { name: "Enhance notes" });
      await expect(enhance).toBeEnabled();
      await enhance.click();
      await expect(page.getByRole("dialog", { name: "AI notes preview" })).toBeVisible();
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });
});
