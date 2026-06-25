import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { waitForApp } from "./seed-data";

// MIN-121: context-aware extraction. These cover the moat end to end: badges
// that tell the cross-meeting story (NEW / UPDATES OIL-x / DUPLICATE OF OIL-x),
// and the real backend that applies a status_update to the existing OIL item.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_OPENROUTER_KEY =
  !!process.env.OPENROUTER_API_KEY || !!process.env.AI_API_KEY;
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
    headers: { ...serviceHeaders(), ...(options.headers ?? {}) },
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

// Series + completed meeting + two existing open OIL items (a risk to resolve
// and an action to re-raise as a duplicate). Returns their auto-assigned numbers.
async function createSeriesWithHistory(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  const notes = `Context coverage ${stamp}: discussion of the support risk and onboarding.`;

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Context series ${stamp}`,
      description: "Created by context-aware suggestion coverage.",
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
      title: `Context session ${stamp}`,
      date: "2026-06-23",
      attendees: ["Alice", "Bob"],
      status: "completed",
      notes_markdown: notes,
      raw_notes_markdown: notes,
      completed_at: new Date().toISOString(),
    },
  });

  const [risk] = await rest(request, "issues", {
    method: "POST",
    data: {
      series_id: seriesId,
      raised_in_meeting_id: meetingId,
      title: "Support queue may spike after launch",
      category: "risk",
      status: "open",
      priority: "high",
      owner_name: "Alice",
    },
  });
  const [dup] = await rest(request, "issues", {
    method: "POST",
    data: {
      series_id: seriesId,
      raised_in_meeting_id: meetingId,
      title: "Ship onboarding checklist",
      category: "action",
      status: "open",
      owner_name: "Bob",
    },
  });

  return {
    seriesId,
    meetingId,
    notes,
    riskId: risk.id as string,
    riskNumber: risk.issue_number as number,
    dupId: dup.id as string,
    dupNumber: dup.issue_number as number,
  };
}

test.describe("Context-aware AI suggestions", () => {
  test("renders NEW, UPDATES, and DUPLICATE context badges", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated suggestion fixtures");
    const f = await createSeriesWithHistory(request);

    try {
      await page.route("**/api/meetings/*/suggestions", async (route) => {
        const method = route.request().method();
        // The UI loads persisted suggestions with GET on open (the auto-extracted
        // ones); regeneration is POST. Serve both from the fixture.
        if (method !== "GET" && method !== "POST") return route.fallback();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            suggestions: [
              {
                id: randomUUID(),
                meeting_id: f.meetingId,
                series_id: f.seriesId,
                type: "new_item",
                category: "action",
                title: "Draft the launch comms plan",
                details: "",
                owner_name: "",
                due_date: null,
                confidence: 0.82,
                source_excerpt: "we still need a comms plan",
                related_issue_number: null,
                suggested_status: null,
                status: "pending",
                created_at: new Date().toISOString(),
                reviewed_at: null,
              },
              {
                id: randomUUID(),
                meeting_id: f.meetingId,
                series_id: f.seriesId,
                type: "status_update",
                category: "risk",
                title: "Support queue risk mitigated with on-call coverage",
                details: "Added two on-call engineers for launch week.",
                owner_name: "Alice",
                due_date: null,
                confidence: 0.91,
                source_excerpt: "we resolved the support queue risk",
                related_issue_number: f.riskNumber,
                suggested_status: "resolved",
                status: "pending",
                created_at: new Date().toISOString(),
                reviewed_at: null,
              },
              {
                id: randomUUID(),
                meeting_id: f.meetingId,
                series_id: f.seriesId,
                type: "duplicate_warning",
                category: "action",
                title: "Build an onboarding checklist",
                details: "",
                owner_name: "",
                due_date: null,
                confidence: 0.74,
                source_excerpt: "we should build an onboarding checklist",
                related_issue_number: f.dupNumber,
                suggested_status: null,
                status: "pending",
                created_at: new Date().toISOString(),
                reviewed_at: null,
              },
            ],
          }),
        });
      });

      await page.goto(`/series/${f.seriesId}/meetings/${f.meetingId}`);
      await waitForApp(page);
      await expect(page.getByRole("heading", { name: /Context session/ })).toBeVisible({
        timeout: 20_000,
      });

      // The auto-extracted suggestions surface as a count on the button before
      // any click: the facilitator sees "3" waiting, not a blank affordance.
      const reviewButton = page.getByRole("button", { name: /Review AI suggestions/ });
      await expect(reviewButton).toContainText("3");
      await reviewButton.click();
      const region = page.getByRole("region", { name: "AI suggestions" });
      await expect(region).toBeVisible();

      // The three distinct context badges.
      await expect(region.getByLabel("New item")).toBeVisible();
      await expect(region.getByLabel(`Updates OIL-${f.riskNumber} to Resolved`)).toBeVisible();
      await expect(region.getByLabel(`Duplicate of OIL-${f.dupNumber}`)).toBeVisible();

      // A duplicate warning is dismiss-only: accepting it would create the very
      // duplicate it flags, so there is no Accept button.
      const duplicate = region.locator("article").filter({ hasText: "Duplicate of" });
      await expect(duplicate.getByRole("button", { name: "Accept suggestion" })).toHaveCount(0);
      await expect(duplicate.getByRole("button", { name: "Reject suggestion" })).toBeVisible();

      // The new item stays fully editable (its title is an input, so scope by
      // the badge); status_update / duplicate are not.
      const newItem = region.locator("article").filter({ has: page.getByLabel("New item") });
      await expect(newItem.getByRole("button", { name: "Accept suggestion" })).toBeVisible();
      await expect(newItem.getByLabel("Suggestion title")).toHaveValue("Draft the launch comms plan");
    } finally {
      await deleteSeries(request, f.seriesId);
    }
  });

  test("accepting a status_update resolves the referenced OIL item with an AI audit row", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated suggestion fixtures");
    const f = await createSeriesWithHistory(request);

    try {
      const [suggestion] = await rest(request, "meeting_ai_suggestions", {
        method: "POST",
        data: {
          meeting_id: f.meetingId,
          series_id: f.seriesId,
          type: "status_update",
          category: "risk",
          title: "Support queue risk resolved",
          details: "Added on-call coverage for launch week.",
          related_issue_number: f.riskNumber,
          suggested_status: "resolved",
          confidence: 0.9,
          source_excerpt: "we resolved the support queue risk",
          status: "pending",
        },
      });

      await page.goto(`/series/${f.seriesId}/meetings/${f.meetingId}`);
      await waitForApp(page);

      const response = await page.request.patch(
        `/api/meetings/${f.meetingId}/suggestions/${suggestion.id}`,
        { data: { action: "accept" }, timeout: 20_000 }
      );
      expect(response.status()).toBe(200);

      // The pre-existing OIL item is now resolved, in THIS meeting.
      const issues = await rest(
        request,
        `issues?id=eq.${f.riskId}&select=status,resolved_in_meeting_id`
      );
      expect(issues[0].status).toBe("resolved");
      expect(issues[0].resolved_in_meeting_id).toBe(f.meetingId);

      // ...with an AI-authored audit row proving the cross-meeting resolution.
      const updates = await rest(
        request,
        `issue_updates?issue_id=eq.${f.riskId}&select=author_type,previous_status,new_status`
      );
      expect(
        updates.some(
          (u: { author_type: string; previous_status: string; new_status: string }) =>
            u.author_type === "ai" && u.previous_status === "open" && u.new_status === "resolved"
        )
      ).toBe(true);

      // The suggestion itself is marked accepted and linked to the item.
      const reviewed = await rest(
        request,
        `meeting_ai_suggestions?id=eq.${suggestion.id}&select=status,created_issue_id`
      );
      expect(reviewed[0].status).toBe("accepted");
      expect(reviewed[0].created_issue_id).toBe(f.riskId);
    } finally {
      await deleteSeries(request, f.seriesId);
    }
  });

  test("a duplicate warning can be dismissed but not accepted", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated suggestion fixtures");
    const f = await createSeriesWithHistory(request);

    try {
      const [suggestion] = await rest(request, "meeting_ai_suggestions", {
        method: "POST",
        data: {
          meeting_id: f.meetingId,
          series_id: f.seriesId,
          type: "duplicate_warning",
          category: "action",
          title: "Build an onboarding checklist",
          related_issue_number: f.dupNumber,
          confidence: 0.7,
          status: "pending",
        },
      });

      await page.goto(`/series/${f.seriesId}/meetings/${f.meetingId}`);
      await waitForApp(page);

      const accept = await page.request.patch(
        `/api/meetings/${f.meetingId}/suggestions/${suggestion.id}`,
        { data: { action: "accept" }, timeout: 20_000 }
      );
      expect(accept.status()).toBe(400);

      // No duplicate item was created behind the warning.
      const dupIssues = await rest(
        request,
        `issues?series_id=eq.${f.seriesId}&select=id&order=created_at.asc`
      );
      expect(dupIssues.length).toBe(2);

      const dismiss = await page.request.patch(
        `/api/meetings/${f.meetingId}/suggestions/${suggestion.id}`,
        { data: { action: "reject" }, timeout: 20_000 }
      );
      expect(dismiss.status()).toBe(200);
    } finally {
      await deleteSeries(request, f.seriesId);
    }
  });

  test("generates context-aware suggestions against series history", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated suggestion fixtures");
    test.skip(!HAS_OPENROUTER_KEY, "Requires OpenRouter for live context-aware extraction");
    test.setTimeout(90_000);

    const f = await createSeriesWithHistory(request);

    try {
      await rest(request, `meetings?id=eq.${f.meetingId}`, {
        method: "PATCH",
        headers: serviceHeaders("return=minimal"),
        data: {
          transcript_raw:
            "Alice: we added on-call staff so the support queue spike risk is fully handled now. Bob: we still need to build the onboarding checklist.",
        },
      });

      const response = await page.request.post(
        `/api/meetings/${f.meetingId}/suggestions`,
        { data: { mode: "generate" }, timeout: 60_000 }
      );
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(Array.isArray(payload.suggestions)).toBe(true);

      // Whatever the model proposes, referential integrity holds end to end:
      // every row has a valid type, a new_item carries no reference, and any
      // status_update / duplicate_warning points at a real open OIL item. This
      // proves normalizeSuggestions ran against the live series history.
      const rows: { type: string; related_issue_number: number | null }[] = await rest(
        request,
        `meeting_ai_suggestions?meeting_id=eq.${f.meetingId}&select=type,related_issue_number`
      );
      const openNumbers = new Set([f.riskNumber, f.dupNumber]);
      for (const r of rows) {
        expect(["new_item", "status_update", "duplicate_warning"]).toContain(r.type);
        if (r.type === "new_item") {
          expect(r.related_issue_number).toBeNull();
        } else {
          expect(openNumbers.has(r.related_issue_number as number)).toBe(true);
        }
      }
    } finally {
      await deleteSeries(request, f.seriesId);
    }
  });
});

test.describe("Context-aware suggestions auth", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("rejects unauthenticated suggestion generation", async ({ request }) => {
    const response = await request.post(`/api/meetings/${randomUUID()}/suggestions`, {
      data: { mode: "generate" },
    });
    expect(response.status()).toBe(401);
  });
});
