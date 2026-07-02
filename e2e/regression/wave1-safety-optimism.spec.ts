import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { waitForApp } from "./seed-data";
import { createDashboardIssue, deleteIssue, HAS_SERVICE_ROLE } from "./dashboard-helpers";

// Wave 1 (Safety / Honesty / Optimism) functional journeys.
//
// Every test here drives the real UI end to end and either creates its own
// throwaway data (deleted at the end via service role) or is fully
// reversible (cancel-aborts / confirm-then-undo), so the shared seed is
// never left mutated. See CLAUDE.md "HARD SEED-SAFETY RULES".

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
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

async function deleteSeriesByName(request: APIRequestContext, name: string) {
  await rest(request, `meeting_series?name=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

/** Seeds a fresh series + a single live meeting; no prior meetings/issues needed. */
async function createLiveMeetingFixture(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();

  await rest(request, "meeting_series", {
    method: "POST",
    data: {
      id: seriesId,
      name: `Wave1 live meeting coverage ${stamp}`,
      description: "Created by wave1 safety/honesty/optimism coverage.",
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
      title: `Wave1 live session ${stamp}`,
      date: "2026-06-23",
      attendees: ["Alice", "Bob"],
      status: "live",
      notes_markdown: "",
      transcript_raw: null,
      completed_at: null,
    },
  });

  return { seriesId, meetingId };
}

/** Creates a series through the real Create Series dialog and opens its detail page. */
async function createSeriesViaUI(page: Page, name: string) {
  await page.goto("/series");
  await waitForApp(page);

  await page.getByRole("button", { name: "Create series" }).click();
  const createDialog = page.getByRole("dialog");
  await createDialog.getByLabel("Name").fill(name);
  await createDialog
    .getByLabel("Description")
    .fill("Created by wave1 delete-series coverage.");
  await createDialog.getByRole("radio", { name: "Weekly", exact: true }).click();
  await createDialog.getByRole("button", { name: "Create series" }).click();
  await expect(createDialog).not.toBeVisible();

  const card = page.locator('main a[href^="/series/"]').filter({ hasText: name });
  await expect(card).toBeVisible();
  await card.click();
  // The card title is also an <h2>, so the heading check below is trivially
  // true even pre-navigation; wait for the URL itself to prove we navigated.
  await page.waitForURL(/\/series\/[^/?#]+$/);
  await expect(page.getByRole("heading", { name }).first()).toBeVisible();

  const seriesId = page.url().match(/\/series\/([^/?#]+)/)?.[1];
  if (!seriesId) throw new Error("Could not resolve created series id from URL");
  return seriesId;
}

test.describe("Wave 1: Safety, Honesty, Optimism", () => {
  test("delete series: cancel aborts, confirm deletes", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for cleanup safety net");

    const name = `Wave1 delete series ${Date.now()}`;
    let seriesId: string | undefined;

    try {
      seriesId = await createSeriesViaUI(page, name);

      // Branch 1: open the danger zone, then cancel. Series must survive.
      await page.getByRole("button", { name: "Series settings" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Delete series" })
        .click();

      const cancelAlert = page.getByRole("alertdialog");
      await expect(cancelAlert).toBeVisible();
      await expect(cancelAlert.getByText("Delete this series?")).toBeVisible();
      await expect(
        cancelAlert.getByText(/permanently deleted/i)
      ).toBeVisible();

      await cancelAlert.getByRole("button", { name: "Cancel" }).click();
      await expect(cancelAlert).not.toBeVisible();

      // The Settings dialog itself is still open behind the cancelled confirm;
      // Radix marks the rest of the page inert while any dialog is open, so
      // close it before asserting on the underlying page.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();

      await expect(page).toHaveURL(new RegExp(`/series/${seriesId}$`));
      await expect(page.getByRole("heading", { name }).first()).toBeVisible();

      // Branch 2: reopen settings and this time confirm the delete.
      await page.getByRole("button", { name: "Series settings" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Delete series" })
        .click();

      const confirmAlert = page.getByRole("alertdialog");
      await expect(confirmAlert).toBeVisible();
      await confirmAlert.getByRole("button", { name: "Delete series" }).click();

      await expect(page).toHaveURL(/\/series$/);
      await expect(
        page.locator('main a[href^="/series/"]').filter({ hasText: name })
      ).toHaveCount(0);

      seriesId = undefined; // successfully deleted; skip the cleanup net below
    } finally {
      if (seriesId) await deleteSeries(request, seriesId);
      await deleteSeriesByName(request, name);
    }
  });

  test("status undo: resolving an issue offers Undo that restores the prior status", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated issue data");

    const { id, title } = await createDashboardIssue(
      request,
      `Wave1 status undo ${Date.now()}`
    );

    try {
      await page.goto(`/issues/${id}`);
      await waitForApp(page);

      await expect(page.locator("h1", { hasText: title })).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Status: Open" })
      ).toBeVisible();

      await page.getByRole("combobox", { name: "Status: Open" }).click();
      await page.getByRole("option", { name: "Resolved" }).click();
      await expect(
        page.getByRole("combobox", { name: "Status: Resolved" })
      ).toBeVisible();

      await expect(page.getByText("Marked resolved")).toBeVisible();
      const undoButton = page.getByRole("button", { name: "Undo" });
      await expect(undoButton).toBeVisible();
      await undoButton.click();

      // Optimistic revert, no reload.
      await expect(
        page.getByRole("combobox", { name: "Status: Open" })
      ).toBeVisible();

      // Server-side revert: still Open after a hard reload.
      await page.reload();
      await waitForApp(page);
      await expect(
        page.getByRole("combobox", { name: "Status: Open" })
      ).toBeVisible();
    } finally {
      await deleteIssue(request, id);
    }
  });

  test("end meeting confirm guard: cancel keeps the meeting live and editable", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated meeting data");

    const fixture = await createLiveMeetingFixture(request);

    try {
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);
      await expect(page.getByText("Live").first()).toBeVisible();

      await page.getByRole("button", { name: "End meeting" }).click();
      const alert = page.getByRole("alertdialog");
      await expect(alert).toBeVisible();
      await expect(alert.getByText("End meeting?")).toBeVisible();

      await alert.getByRole("button", { name: "Cancel" }).click();
      await expect(alert).not.toBeVisible();

      // Meeting is still live: same End meeting control, notes still editable.
      await expect(page.getByText("Live").first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: "End meeting" })
      ).toBeVisible();
      const notes = page.getByPlaceholder("Type meeting notes here...");
      await expect(notes).toBeVisible();
      await expect(notes).toBeEditable();
    } finally {
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("in-meeting decision optimism: a captured decision appears immediately", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated meeting data");

    const fixture = await createLiveMeetingFixture(request);
    const decisionTitle = `Wave1 decision optimism ${Date.now()}`;

    try {
      await page.goto(`/series/${fixture.seriesId}/meetings/${fixture.meetingId}`);
      await waitForApp(page);
      await expect(page.getByText("Live").first()).toBeVisible();

      await page.getByRole("radio", { name: "Decision" }).click();
      await page.getByLabel("Capture input").fill(decisionTitle);
      await page.keyboard.press("Enter");

      // No reload here: this is the optimistic-render assertion.
      await expect(page.getByText(decisionTitle).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();
    } finally {
      // Throwaway series+meeting; deleting the series cascades the decision,
      // there is no standalone decision-delete control in the UI.
      await deleteSeries(request, fixture.seriesId);
    }
  });

  test("remove-member confirm guard: cancel keeps the member listed", async ({
    page,
  }) => {
    test.skip(
      true,
      "Seed provisions only a single workspace member (the authenticated test " +
        "user); self-removal is disabled (see settings-workspace-access.spec.ts), " +
        "so there is no second member to exercise this guard without provisioning " +
        "a real second auth user, which is out of scope for this journey."
    );
    void page;
  });
});
