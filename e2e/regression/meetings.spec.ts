import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { SERIES, MEETINGS, waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function getSeedOwnerId(request: APIRequestContext) {
  const rows = await rest(
    request,
    `meeting_series?id=eq.${SERIES.platformStandup}&select=owner_id`
  );
  expect(rows[0]?.owner_id).toBeTruthy();
  return rows[0].owner_id as string;
}

async function createMeetingFlowFixture(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const priorMeetingId = randomUUID();
  const meetingId = randomUUID();
  const carriedIssueId = randomUUID();
  const seriesName = `Meeting flow coverage ${stamp}`;
  const carriedTitle = `Carry launch blocker ${stamp}`;
  const actionTitle = `Investigate alert routing ${stamp}`;
  const decisionTitle = `Ship weekly release train ${stamp}`;
  const noteText = `Meeting flow notes ${stamp}`;

  try {
    await rest(request, "meeting_series", {
      method: "POST",
      data: {
        id: seriesId,
        name: seriesName,
        description: "Created by meeting flow functional coverage.",
        cadence: "weekly",
        default_attendees: ["Alice", "Bob"],
        owner_id: await getSeedOwnerId(request),
      },
    });
    await rest(request, "meetings", {
      method: "POST",
      data: [
        {
          id: priorMeetingId,
          series_id: seriesId,
          sequence_number: 1,
          title: `${seriesName} kickoff`,
          date: "2026-05-18",
          attendees: ["Alice", "Bob"],
          status: "completed",
          notes_markdown: "",
          transcript_raw: null,
          completed_at: new Date().toISOString(),
        },
        {
          id: meetingId,
          series_id: seriesId,
          sequence_number: 2,
          title: `${seriesName} working session`,
          date: "2026-05-20",
          attendees: ["Alice", "Bob"],
          status: "upcoming",
          notes_markdown: "",
          transcript_raw: null,
          completed_at: null,
        },
      ],
    });
    await rest(request, "issues", {
      method: "POST",
      data: {
        id: carriedIssueId,
        series_id: seriesId,
        raised_in_meeting_id: priorMeetingId,
        title: carriedTitle,
        description: "Open item carried into the meeting flow.",
        category: "blocker",
        status: "open",
        priority: "high",
        owner_name: "Alice",
        source: "manual",
      },
    });
  } catch (error) {
    await deleteSeries(request, seriesId).catch(() => undefined);
    throw error;
  }

  return {
    seriesId,
    meetingId,
    carriedTitle,
    actionTitle,
    decisionTitle,
    noteText,
  };
}

test.describe("Meeting Detail (Completed)", () => {
  const url = `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup2}`;

  test("renders completed meeting with all sections", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByText("Platform Team Standup").first()
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Platform Standup #2" })
    ).toBeVisible();

    await expect(page.getByText(/April 8, 2026/i).first()).toBeVisible();

    await expect(page.getByText("Alice").first()).toBeVisible();
    await expect(page.getByText("Bob").first()).toBeVisible();
    await expect(page.getByText("Carol").first()).toBeVisible();

    await expect(page.getByText(/Items raised/i).first()).toBeVisible();
    await expect(page.getByText(/Decisions/i).first()).toBeVisible();
    await expect(page.getByText("Notes").first()).toBeVisible();
  });

  test("decisions are displayed with rationale", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByText("Use GitHub Actions for CI/CD")
    ).toBeVisible();
  });

  test("notes textarea is editable", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEditable();
  });

  test("back link navigates to series detail", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await page
      .locator(`a[href="/series/${SERIES.platformStandup}"]`)
      .first()
      .click();
    await expect(page).toHaveURL(`/series/${SERIES.platformStandup}`);
  });
});

test.describe("Meeting Lifecycle", () => {
  test("starts, runs, and completes a meeting with persisted capture", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role cleanup for isolated meeting data");

    const fixture = await createMeetingFlowFixture(request);

    try {
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);

      await expect(
        page.getByRole("heading", { name: /working session/ })
      ).toBeVisible();
      await expect(page.getByText("Brief", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Alice").first()).toBeVisible();

      await page.getByRole("button", { name: "Start meeting" }).click();

      await expect(page.getByText("Live").first()).toBeVisible();
      await expect(page.getByText(fixture.carriedTitle).first()).toBeVisible();

      await page.getByText(fixture.carriedTitle).first().hover();
      await page.getByTitle("R to Resolve").click();
      await expect(page.getByText("Done this meeting")).toBeVisible();
      await expect(page.getByText("Resolved").first()).toBeVisible();

      await page.getByLabel("Capture input").fill(fixture.actionTitle);
      await page.keyboard.press("Enter");
      await expect(page.getByText(fixture.actionTitle).first()).toBeVisible();

      await page.getByRole("radio", { name: "Decision" }).click();
      await page.getByLabel("Capture input").fill(fixture.decisionTitle);
      await page.keyboard.press("Enter");
      await expect(page.getByText(fixture.decisionTitle).first()).toBeVisible();

      await page.getByPlaceholder("Type meeting notes here...").fill(fixture.noteText);
      await expect(
        page.getByPlaceholder("Type meeting notes here...")
      ).toHaveValue(fixture.noteText);
      await expect
        .poll(async () => {
          const rows = await rest(
            request,
            `meetings?id=eq.${fixture.meetingId}&select=notes_markdown`
          );
          return rows[0]?.notes_markdown;
        }, { timeout: 20_000 })
        .toBe(fixture.noteText);

      await page.getByRole("button", { name: "End meeting" }).click();

      await expect(page.getByText("Meeting complete")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Items raised (1)" })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Decisions (1)" })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Resolved this meeting (1)" })
      ).toBeVisible();
      await expect(page.getByText(fixture.actionTitle).first()).toBeVisible();
      await expect(page.getByText(fixture.decisionTitle).first()).toBeVisible();
      await expect(page.getByText(fixture.carriedTitle).first()).toBeVisible();
      await expect(page.getByPlaceholder("Meeting notes...")).toHaveValue(
        fixture.noteText
      );

      await page.reload();
      await waitForApp(page);
      await expect(page.getByText("Meeting complete")).toBeVisible();
      await expect(page.getByPlaceholder("Meeting notes...")).toHaveValue(
        fixture.noteText
      );

      const meetingRows = await rest(
        request,
        `meetings?id=eq.${fixture.meetingId}&select=status,notes_markdown,completed_at`
      );
      expect(meetingRows[0]).toMatchObject({
        status: "completed",
        notes_markdown: fixture.noteText,
      });
      expect(meetingRows[0].completed_at).toBeTruthy();

      const issueRows = await rest(
        request,
        `issues?series_id=eq.${fixture.seriesId}&select=title,status,resolved_in_meeting_id,raised_in_meeting_id`
      );
      expect(issueRows).toContainEqual(
        expect.objectContaining({
          title: fixture.carriedTitle,
          status: "resolved",
          resolved_in_meeting_id: fixture.meetingId,
        })
      );
      expect(issueRows).toContainEqual(
        expect.objectContaining({
          title: fixture.actionTitle,
          raised_in_meeting_id: fixture.meetingId,
        })
      );

      const decisionRows = await rest(
        request,
        `decisions?meeting_id=eq.${fixture.meetingId}&select=title`
      );
      expect(decisionRows).toContainEqual(
        expect.objectContaining({ title: fixture.decisionTitle })
      );
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });
});

test.describe("Meeting Detail (Upcoming)", () => {
  const url = `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup4}`;

  test("renders upcoming meeting with brief and start button", async ({
    page,
  }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Platform Standup #4" })
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Start meeting" })
    ).toBeVisible();

    await expect(
      page.getByText("Brief", { exact: true }).first()
    ).toBeVisible();

    await expect(page.getByText("Attendees").first()).toBeVisible();
    await expect(page.getByText("Alice").first()).toBeVisible();
    await expect(page.getByText("Bob").first()).toBeVisible();
    await expect(page.getByText("Carol").first()).toBeVisible();
  });
});

test.describe("Meeting Detail (Retro)", () => {
  const url = `/series/${SERIES.incidentRetro}/meetings/${MEETINGS.retro}`;

  test("retro meeting renders with notes and issues", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: /Retro: API Outage/i })
    ).toBeVisible();

    await expect(page.getByText("Frank").first()).toBeVisible();
    await expect(page.getByText("Grace").first()).toBeVisible();

    await expect(page.getByText("Notes").first()).toBeVisible();
  });
});
