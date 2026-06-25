import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { SERIES, waitForApp } from "./seed-data";
import { createDashboardIssue, deleteIssue, HAS_SERVICE_ROLE } from "./dashboard-helpers";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

// A dedicated, recent-past meeting in the series. Being the most recent past
// meeting makes it the auto-expanded (index 0) section, and no other spec writes
// issues to it, so its "Issues (N)" group is pollution-proof.
async function createTimelineMeeting(request: APIRequestContext, title: string) {
  const id = randomUUID();
  const res = await request.post(`${SUPABASE_URL}/rest/v1/meetings`, {
    headers: serviceHeaders(),
    data: {
      id,
      series_id: SERIES.platformStandup,
      sequence_number: 999,
      title,
      date: "2026-06-20T09:00:00Z",
      attendees: [],
      status: "completed",
      notes_markdown: "",
    },
  });
  expect(res.ok()).toBeTruthy();
  return id;
}

async function deleteMeeting(request: APIRequestContext, id: string) {
  await request.delete(`${SUPABASE_URL}/rest/v1/meetings?id=eq.${id}`, {
    headers: serviceHeaders(),
  });
}

// Elevation: card surfaces are differentiated by shadow, not ring/border.
// (Retry the read: Tailwind's dev JIT compiles the arbitrary shadow utility on
// first request, so a single read can race the CSS injection.)
test.describe("Elevation: shadows replace card borders", () => {
  test("dashboard widget cards have a drop shadow and no border", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForApp(page);

    const card = page.locator(".widget-card-content").first();
    await expect(card).toBeVisible();
    await expect
      .poll(() => card.evaluate((el) => getComputedStyle(el).boxShadow))
      .not.toBe("none");
    const borderTopWidth = await card.evaluate(
      (el) => getComputedStyle(el).borderTopWidth
    );
    expect(borderTopWidth).toBe("0px");
  });

  test("Card primitive surfaces carry shadow elevation", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const card = page.locator("[data-slot=card]").first();
    await expect(card).toBeVisible();
    await expect
      .poll(() => card.evaluate((el) => getComputedStyle(el).boxShadow))
      .not.toBe("none");
  });
});

// Canvas bounds: a meeting that raises more than 2 issues shows only 2 until
// expanded, so the timeline never stretches unbounded. Seed exactly 3 issues
// raised in one meeting (deterministic) and assert the cap.
test.describe("Canvas bounds: issues per meeting", () => {
  test("a meeting's issues are capped at 2 with a Show all control that expands in place", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "SUPABASE_SERVICE_ROLE_KEY is required to seed issues");

    const created: { id: string }[] = [];
    let meetingId: string | null = null;
    try {
      const stamp = Date.now();
      meetingId = await createTimelineMeeting(request, `Bounds meeting ${stamp}`);
      for (let i = 0; i < 3; i++) {
        created.push(
          await createDashboardIssue(request, `Bounds cap ${i} ${stamp}`, {
            raised_in_meeting_id: meetingId,
          })
        );
      }

      await page.goto(`/series/${SERIES.platformStandup}`);
      await waitForApp(page);

      // The dedicated meeting is the most recent past meeting, so it auto-expands.
      // It raises exactly 3 issues (no other spec writes to it), so "Issues (3)" is
      // a pollution-proof anchor that survives expansion, unlike the Show-all
      // button which disappears once clicked.
      const group = page.getByText("Issues (3)", { exact: true }).locator("..");
      const rows = group.locator("a[href*='/issues/']");
      await expect(group.getByRole("button", { name: /Show all 3 items/ })).toBeVisible();
      await expect(rows).toHaveCount(2);

      // Expanding reveals the rest in place (no navigation to a separate page).
      await group.getByRole("button", { name: /Show all 3 items/ }).click();
      await expect(rows).toHaveCount(3);
    } finally {
      for (const issue of created) await deleteIssue(request, issue.id);
      if (meetingId) await deleteMeeting(request, meetingId);
    }
  });
});
