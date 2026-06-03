import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe("Lazy shell data fetching", () => {
  test("command palette waits to fetch searchable data until opened", async ({
    page,
  }) => {
    let decisionFetches = 0;

    await page.route("**/rest/v1/decisions?**", async (route) => {
      decisionFetches += 1;
      await route.continue();
    });

    await page.goto("/inbox", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.waitForTimeout(500);

    expect(decisionFetches).toBe(0);

    await page.getByRole("button", { name: /Search/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await expect
      .poll(() => decisionFetches, { timeout: 5000 })
      .toBeGreaterThan(0);
  });

  test("calendar sidebar waits to fetch agenda data until opened", async ({
    page,
  }) => {
    const calendarFetches = {
      status: 0,
      agenda: 0,
      monthMeetings: 0,
    };

    await page.addInitScript(() => {
      localStorage.removeItem("minutia:calendar-sidebar");
    });

    await page.route("**/api/calendar/status", async (route) => {
      calendarFetches.status += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          directoryConnected: true,
          googleEmail: "seed@example.com",
        }),
      });
    });
    await page.route("**/api/calendar/agenda", async (route) => {
      calendarFetches.agenda += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          syncedAt: new Date().toISOString(),
          events: [],
        }),
      });
    });
    await page.route("**/rest/v1/meetings?**", async (route, request) => {
      const url = decodeURIComponent(request.url());
      if (url.includes("series:meeting_series!inner")) {
        calendarFetches.monthMeetings += 1;
      }
      await route.continue();
    });

    await page.goto("/inbox", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await page.waitForTimeout(500);

    expect(calendarFetches).toEqual({
      status: 0,
      agenda: 0,
      monthMeetings: 0,
    });

    await page.getByRole("button", { name: "Open calendar" }).click();
    await expect(
      page.getByRole("complementary", { name: "Calendar sidebar" })
    ).toBeVisible();

    await expect
      .poll(() => calendarFetches.status, { timeout: 5000 })
      .toBeGreaterThan(0);
    await expect
      .poll(() => calendarFetches.agenda, { timeout: 5000 })
      .toBeGreaterThan(0);
    await expect
      .poll(() => calendarFetches.monthMeetings, { timeout: 5000 })
      .toBeGreaterThan(0);
  });
});
