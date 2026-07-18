import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { readOutbox, withOutbox } from "../helpers/outbox";
import { SERIES, waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALICE_SEED_ITEM = "Update API rate limiting config";

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
  pathPart: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {}
) {
  const response = await request.fetch(`${SUPABASE_URL}/rest/v1/${pathPart}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers ?? {}) },
  });
  expect(response.ok()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

async function getSeedOwnerId(request: APIRequestContext) {
  const rows = await rest(
    request,
    `meeting_series?id=eq.${SERIES.platformStandup}&select=owner_id`
  );
  expect(rows[0]?.owner_id).toBeTruthy();
  return rows[0].owner_id as string;
}

async function deleteSeries(request: APIRequestContext, id: string) {
  await rest(request, `meeting_series?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

async function createBriefFixture(request: APIRequestContext) {
  const stamp = Date.now();
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  const ownerId = await getSeedOwnerId(request);
  const aliceIssueTitle = `Alice ships the migration ${stamp}`;
  const bobIssueTitle = `Bob reviews the runbook ${stamp}`;

  try {
    await rest(request, "meeting_series", {
      method: "POST",
      data: {
        id: seriesId,
        name: `Brief loop coverage ${stamp}`,
        description: "Created by brief email coverage.",
        cadence: "weekly",
        default_attendees: ["Alice"],
        owner_id: ownerId,
      },
    });
    await rest(request, "meetings", {
      method: "POST",
      data: {
        id: meetingId,
        series_id: seriesId,
        sequence_number: 1,
        title: `Brief loop sync ${stamp}`,
        date: "2026-12-01",
        attendees: [],
        status: "upcoming",
        notes_markdown: "",
      },
    });
    await rest(request, "issues", {
      method: "POST",
      data: {
        id: randomUUID(),
        series_id: seriesId,
        raised_in_meeting_id: meetingId,
        title: aliceIssueTitle,
        category: "action",
        status: "open",
        priority: "high",
        owner_name: "Alice",
        source: "manual",
      },
    });
    await rest(request, "issues", {
      method: "POST",
      data: {
        id: randomUUID(),
        series_id: seriesId,
        raised_in_meeting_id: meetingId,
        title: bobIssueTitle,
        category: "action",
        status: "open",
        priority: "medium",
        owner_name: "Bob",
        source: "manual",
      },
    });
  } catch (error) {
    await deleteSeries(request, seriesId).catch(() => undefined);
    throw error;
  }

  return { seriesId, aliceIssueTitle, bobIssueTitle };
}

test.describe("Brief email growth loop", () => {
  test("edits attendees, emails per-recipient briefs, deep-links the guest view", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role for isolated brief data");

    const fx = await createBriefFixture(request);

    try {
      await withOutbox(async () => {
        await page.goto(`/series/${fx.seriesId}`);
        await waitForApp(page);

        // Edit the series' attendees from bare names to real emails via the UI.
        await page.getByRole("button", { name: "Series settings" }).click();
        await page.getByLabel("Default attendees").fill("alice@example.com, bob@example.com");
        await page.getByRole("button", { name: "Save changes" }).click();
        await expect(page.getByRole("button", { name: "Save changes" })).toBeHidden();

        await page.getByTestId("send-brief-btn").click();
        await expect(page.getByText(/Brief sent to 2 attendees/)).toBeVisible({
          timeout: 15_000,
        });

        const outbox = await readOutbox();
        expect(outbox.length).toBe(2);

        const alice = outbox.find((e) => e.to === "alice@example.com");
        const bob = outbox.find((e) => e.to === "bob@example.com");
        expect(alice, "alice received a brief").toBeTruthy();
        expect(bob, "bob received a brief").toBeTruthy();

        // Shared branded layout.
        expect(alice!.html).toContain("prefers-color-scheme");
        expect(alice!.subject).toContain("Brief:");

        // Per-recipient "Your open items" holds only the recipient's own item.
        const aliceOwn = alice!.html.slice(
          alice!.html.indexOf("Your open items"),
          alice!.html.indexOf("Also on the log")
        );
        expect(aliceOwn).toContain(fx.aliceIssueTitle);
        expect(aliceOwn).not.toContain(fx.bobIssueTitle);

        const bobOwn = bob!.html.slice(
          bob!.html.indexOf("Your open items"),
          bob!.html.indexOf("Also on the log")
        );
        expect(bobOwn).toContain(fx.bobIssueTitle);
        expect(bobOwn).not.toContain(fx.aliceIssueTitle);

        // Guest deep link carries the recipient for the pending-items view.
        expect(alice!.html).toContain("/share/");
        expect(alice!.html).toContain(`?you=${encodeURIComponent("alice@example.com")}`);
        expect(bob!.html).toContain(`?you=${encodeURIComponent("bob@example.com")}`);
      });
    } finally {
      await deleteSeries(request, fx.seriesId);
    }
  });
});

test.describe("Guest pending-items view", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("share ?you= surfaces the visitor's own open items first", async ({ page }) => {
    await page.goto("/share/test-share-series-def456?you=alice@example.com");

    const pending = page.locator("section", {
      has: page.getByText("Your pending items"),
    });
    await expect(pending).toBeVisible();
    await expect(pending.getByText(ALICE_SEED_ITEM)).toBeVisible();
  });

  test("share without ?you= shows no pending-items section", async ({ page }) => {
    await page.goto("/share/test-share-series-def456");
    await expect(page.getByText("Open issues")).toBeVisible();
    await expect(page.getByText("Your pending items")).toHaveCount(0);
  });
});
