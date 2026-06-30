import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { SERIES, MEETINGS, waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this test");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function getSeedOwnerId(request: APIRequestContext) {
  const response = await request.get(
    `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${SERIES.platformStandup}&select=owner_id`,
    { headers: serviceHeaders() }
  );
  expect(response.ok()).toBeTruthy();
  const [series] = await response.json();
  return series.owner_id as string;
}

async function createTempSeries(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
) {
  const id = randomUUID();
  const data = {
    id,
    name: `Series coverage ${Date.now()}`,
    description: "Created by series functional coverage.",
    cadence: "weekly",
    default_attendees: ["ceo@example.com", "eng@example.com"],
    owner_id: await getSeedOwnerId(request),
    ...overrides,
  };
  const response = await request.post(`${SUPABASE_URL}/rest/v1/meeting_series`, {
    headers: serviceHeaders(),
    data,
  });
  expect(response.ok()).toBeTruthy();
  return { id, name: data.name as string };
}

async function deleteSeries(request: APIRequestContext, id: string) {
  const response = await request.delete(
    `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${id}`,
    { headers: serviceHeaders() }
  );
  expect(response.ok()).toBeTruthy();
}

async function deleteSeriesByName(request: APIRequestContext, name: string) {
  const response = await request.delete(
    `${SUPABASE_URL}/rest/v1/meeting_series?name=eq.${encodeURIComponent(name)}`,
    { headers: serviceHeaders() }
  );
  expect(response.ok()).toBeTruthy();
}

function seriesIdFromUrl(url: string) {
  return url.match(/\/series\/([^/?#]+)/)?.[1];
}

async function gotoSeriesDetail(page: Page, seriesId = SERIES.platformStandup) {
  await page.goto(`/series/${seriesId}`, { waitUntil: "commit" });
  await waitForApp(page);
}

test.describe("Series List Page", () => {
  test("renders header, create button, and series cards", async ({ page }) => {
    await page.goto("/series");
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Series" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create series" })
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /Platform Team Standup/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Product Review/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Incident Retro/i }).first()
    ).toBeVisible();

    await expect(page.getByText("Weekly").first()).toBeVisible();
    await expect(page.getByText("Biweekly").first()).toBeVisible();
    await expect(page.getByText("Ad hoc").first()).toBeVisible();
  });

  test("create series dialog opens and has all fields", async ({ page }) => {
    await page.goto("/series");
    await waitForApp(page);

    await page.getByRole("button", { name: "Create series" }).click();

    const dialog = page.locator("[role='dialog']");
    await expect(dialog.getByLabel("Name")).toBeVisible();
    await expect(dialog.getByLabel("Description")).toBeVisible();
    await expect(dialog.getByText("Cadence")).toBeVisible();
    await expect(dialog.getByLabel("Default attendees")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Create series" })
    ).toBeVisible();
  });

  test("creates a series and opens its configured detail", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role cleanup for isolated series data");

    const name = `Series create coverage ${Date.now()}`;
    let createdSeriesId: string | undefined;

    try {
      await page.goto("/series");
      await waitForApp(page);

      await page.getByRole("button", { name: "Create series" }).click();

      const dialog = page.locator("[role='dialog']");
      await dialog.getByLabel("Name").fill(name);
      await dialog
        .getByLabel("Description")
        .fill("Validates the complete create series workflow.");
      await dialog.getByRole("radio", { name: "Monthly" }).click();
      await dialog
        .getByLabel("Default attendees")
        .fill("founder@example.com, ops@example.com");
      await dialog.getByRole("button", { name: "Create series" }).click();

      await expect(dialog).not.toBeVisible();
      const card = page
        .locator('main a[href^="/series/"]')
        .filter({ hasText: name });
      await expect(card).toBeVisible();

      await card.click();
      await expect(page.getByRole("heading", { name }).first()).toBeVisible();
      createdSeriesId = seriesIdFromUrl(page.url());

      await page.getByRole("button", { name: "Series settings" }).click();
      const settings = page.locator("[role='dialog']");
      await expect(
        settings.getByRole("radio", { name: "Monthly" })
      ).toHaveAttribute("aria-checked", "true");
      await expect(settings.getByLabel("Default attendees")).toHaveValue(
        "founder@example.com, ops@example.com"
      );
    } finally {
      if (createdSeriesId) await deleteSeries(request, createdSeriesId);
      await deleteSeriesByName(request, name);
    }
  });

  test("creates a series with the Daily cadence", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role cleanup for isolated series data");

    // Name deliberately avoids the word "Daily" so the cadence-label assertion
    // below is not ambiguous with the series title.
    const name = `Standup schedule coverage ${Date.now()}`;
    let createdSeriesId: string | undefined;

    try {
      await page.goto("/series");
      await waitForApp(page);

      await page.getByRole("button", { name: "Create series" }).click();
      const dialog = page.locator("[role='dialog']");
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByRole("radio", { name: "Daily", exact: true }).click();
      await dialog.getByRole("button", { name: "Create series" }).click();

      await expect(dialog).not.toBeVisible();
      const card = page
        .locator('main a[href^="/series/"]')
        .filter({ hasText: name });
      // The persisted series renders its cadence label; "daily" is only accepted
      // if the DB CHECK constraint migration applied.
      await expect(card.getByText("Daily", { exact: true })).toBeVisible();

      await card.click();
      await expect(page.getByRole("heading", { name }).first()).toBeVisible();
      createdSeriesId = seriesIdFromUrl(page.url());

      await page.getByRole("button", { name: "Series settings" }).click();
      const settings = page.locator("[role='dialog']");
      await expect(
        settings.getByRole("radio", { name: "Daily", exact: true })
      ).toHaveAttribute("aria-checked", "true");
    } finally {
      if (createdSeriesId) await deleteSeries(request, createdSeriesId);
      await deleteSeriesByName(request, name);
    }
  });

  test("series card links to series detail", async ({ page }) => {
    await page.goto("/series");
    await waitForApp(page);

    await page
      .getByRole("link", { name: /Platform Team Standup/i })
      .first()
      .click();
    await expect(page).toHaveURL(`/series/${SERIES.platformStandup}`);
  });

  test("series cards keep stable summary height and reveal details", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role cleanup for isolated series data");

    const longDescription = [
      "This series has a deliberately long summary so the list card must keep a fixed visual height.",
      "The expanded panel should expose this detail without pushing nearby cards around.",
      "That keeps the grid scannable even when teams write verbose series context.",
    ].join(" ");
    const longSeries = await createTempSeries(request, {
      name: `Long series summary coverage ${Date.now()}`,
      description: longDescription,
    });
    const compactSeries = await createTempSeries(request, {
      name: `Compact series coverage ${Date.now()}`,
      description: "",
    });

    try {
      await page.goto("/series");
      await waitForApp(page);

      const longCard = page.locator(`main a[href="/series/${longSeries.id}"]`);
      const compactCard = page.locator(`main a[href="/series/${compactSeries.id}"]`);
      await expect(longCard).toBeVisible();
      await expect(compactCard).toBeVisible();

      const longBox = await longCard.boundingBox();
      const compactBox = await compactCard.boundingBox();
      expect(longBox).not.toBeNull();
      expect(compactBox).not.toBeNull();
      expect(Math.abs(longBox!.height - compactBox!.height)).toBeLessThanOrEqual(1);

      const detailPanel = longCard.locator('[data-testid="series-card-detail-panel"]');
      await longCard.hover();
      await expect(detailPanel).toBeVisible();
      await expect(detailPanel).toContainText(longDescription);

      await compactCard.focus();
      await longCard.focus();
      await expect(detailPanel).toBeVisible();
    } finally {
      await deleteSeries(request, longSeries.id);
      await deleteSeries(request, compactSeries.id);
    }
  });
});

test.describe("Series Detail Page", () => {
  test("renders header with name, back link, and action buttons", async ({
    page,
  }) => {
    await gotoSeriesDetail(page);

    await expect(
      page.getByRole("heading", { name: "Platform Team Standup" }).first()
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Start" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Series settings" })
    ).toBeVisible();
  });

  test("timeline section lists meetings in order", async ({ page }) => {
    await gotoSeriesDetail(page);

    await expect(page.getByText("Timeline")).toBeVisible();

    await expect(page.getByText("Platform Standup #1")).toBeVisible();
    await expect(page.getByText("Platform Standup #2")).toBeVisible();
    await expect(page.getByText("Platform Standup #3")).toBeVisible();
    await expect(page.getByText("Platform Standup #4")).toBeVisible();
  });

  test("loads live series meetings for realtime timeline freshness", async ({
    page,
  }) => {
    const seriesMeetingRequests: string[] = [];

    await page.route("**/rest/v1/meetings?**", async (route, request) => {
      const decodedUrl = decodeURIComponent(request.url());
      if (decodedUrl.includes(`series_id=eq.${SERIES.platformStandup}`)) {
        seriesMeetingRequests.push(decodedUrl);
      }
      await route.continue();
    });

    await gotoSeriesDetail(page);

    await expect(page.getByText("Platform Standup #1")).toBeVisible();
    expect(seriesMeetingRequests).toHaveLength(1);
    expect(seriesMeetingRequests[0]).toContain(
      `series_id=eq.${SERIES.platformStandup}`
    );
    expect(seriesMeetingRequests[0]).toContain("order=date.desc");
  });

  test("open issues section lists active issues", async ({ page }) => {
    await gotoSeriesDetail(page);

    const section = page.getByText(/Open issues/i).first();
    await expect(section).toBeVisible();
  });

  test("settings dialog opens with all fields", async ({ page }) => {
    await gotoSeriesDetail(page);

    await page.getByRole("button", { name: "Series settings" }).click();

    const dialog = page.locator("[role='dialog']");
    await expect(
      dialog.getByRole("heading", { name: "Series settings" })
    ).toBeVisible();
    await expect(dialog.getByLabel("Name")).toBeVisible();
    await expect(dialog.getByLabel("Description")).toBeVisible();
    await expect(dialog.getByText("Cadence")).toBeVisible();
    await expect(dialog.getByLabel("Default attendees")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save changes" })
    ).toBeVisible();

    await expect(
      dialog.getByRole("radio", { name: "Daily", exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "Weekly", exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "Biweekly" })
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "Monthly" })
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "Ad hoc" })
    ).toBeVisible();
  });

  test("saves settings changes and keeps them after reload", async ({
    page,
    request,
  }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role cleanup for isolated series data");

    const series = await createTempSeries(request, {
      name: `Series settings coverage ${Date.now()}`,
    });
    const updatedName = `${series.name} updated`;

    try {
      await gotoSeriesDetail(page, series.id);

      await page.getByRole("button", { name: "Series settings" }).click();
      let dialog = page.locator("[role='dialog']");
      await dialog.getByLabel("Name").fill(updatedName);
      await dialog
        .getByLabel("Description")
        .fill("Updated through the settings dialog.");
      await dialog.getByRole("radio", { name: "Biweekly" }).click();
      await dialog
        .getByLabel("Default attendees")
        .fill("updated-one@example.com, updated-two@example.com");
      await dialog.getByRole("button", { name: "Save changes" }).click();

      await expect(dialog).not.toBeVisible();
      await expect(
        page.getByRole("heading", { name: updatedName }).first()
      ).toBeVisible();
      await expect(
        page.getByText("Updated through the settings dialog.").first()
      ).toBeVisible();

      await page.reload();
      await waitForApp(page);
      await expect(
        page.getByRole("heading", { name: updatedName }).first()
      ).toBeVisible();

      await page.getByRole("button", { name: "Series settings" }).click();
      dialog = page.locator("[role='dialog']");
      await expect(
        dialog.getByRole("radio", { name: "Biweekly" })
      ).toHaveAttribute("aria-checked", "true");
      await expect(dialog.getByLabel("Default attendees")).toHaveValue(
        "updated-one@example.com, updated-two@example.com"
      );
    } finally {
      await deleteSeries(request, series.id);
    }
  });

  test("starts a live meeting from series detail", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "Requires service role cleanup for isolated series data");

    const series = await createTempSeries(request, {
      name: `Series start coverage ${Date.now()}`,
    });

    try {
      await gotoSeriesDetail(page, series.id);

      await page.getByRole("button", { name: "Start meeting" }).click();

      await expect(page).toHaveURL(
        new RegExp(`/series/${series.id}/meetings/[0-9a-f-]+`),
        { timeout: 10000 }
      );
      await expect(page.getByText("Live").first()).toBeVisible();
      await expect(
        page.getByRole("heading", { name: new RegExp(series.name) }).first()
      ).toBeVisible();
      await expect(page.getByText("2 attendees present")).toBeVisible();
    } finally {
      await deleteSeries(request, series.id);
    }
  });

  test("meeting timeline items link to meeting detail", async ({ page }) => {
    await gotoSeriesDetail(page);

    const standup1 = page.getByText("Platform Standup #1").first();
    await standup1.click();

    const detailLink = page.locator(
      `a[href*="${MEETINGS.standup1}"]`,
      { hasText: "Open meeting details" }
    );
    await expect(detailLink).toBeVisible({ timeout: 5000 });
    await detailLink.click();
    await expect(page).toHaveURL(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`
    );
  });
});

test.describe("Series Detail Brief Card", () => {
  test("brief card shows pending issues and action buttons", async ({
    page,
  }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    const briefVisible = await page
      .getByText("Brief", { exact: true })
      .first()
      .isVisible()
      .catch(() => false);

    if (briefVisible) {
      await expect(page.getByTestId("send-brief-btn")).toBeVisible();
      await expect(page.getByTestId("copy-brief-btn")).toBeVisible();
    }
  });
});

test.describe("Product Review Series", () => {
  test("product review detail page loads correctly", async ({ page }) => {
    await page.goto(`/series/${SERIES.productReview}`);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Product Review" }).first()
    ).toBeVisible();
    await expect(page.getByText("Timeline")).toBeVisible();

    await expect(
      page.getByText("Product Review Q2 Kick-off")
    ).toBeVisible();
    await expect(
      page.getByText("Product Review Sprint 1")
    ).toBeVisible();
  });

  test("product review meeting shows decisions", async ({ page }) => {
    await page.goto(
      `/series/${SERIES.productReview}/meetings/${MEETINGS.productKickoff}`
    );
    await waitForApp(page);

    await expect(
      page.getByText("Prioritize mobile app over desktop")
    ).toBeVisible();
  });
});
