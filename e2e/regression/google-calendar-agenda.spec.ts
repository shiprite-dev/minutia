import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe("Google Calendar agenda", () => {
  test("opens calendar event details and starts capture from the sidebar", async ({
    page,
    request,
  }) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const serviceHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    await request.patch(`${supabaseUrl}/rest/v1/instance_config?key=eq.setup_completed`, {
      headers: serviceHeaders,
      data: { value: "true" },
    });
    await request.patch(`${supabaseUrl}/rest/v1/profiles?id=eq.00000000-0000-0000-0000-000000000001`, {
      headers: {
        ...serviceHeaders,
        Prefer: "return=representation",
      },
      data: { has_completed_onboarding: true },
    });

    await page.route("**/api/calendar/status", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          googleEmail: "pratik@example.com",
        }),
      });
    });

    await page.route("**/api/calendar/agenda", async (route) => {
      const now = new Date();
      const start = new Date(now);
      start.setHours(10, 0, 0, 0);
      const end = new Date(now);
      end.setHours(10, 30, 0, 0);

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          connected: true,
          syncedAt: now.toISOString(),
          events: [
            {
              id: "calendar-event-1",
              calendarId: "primary",
              eventId: "recurring-1_20260601T170000Z",
              seriesId: "10000000-0000-0000-0000-000000000001",
              meetingId: "20000000-0000-0000-0000-000000000004",
              seriesKind: "recurring",
              title: "Product operating review",
              description: "Review open launch blockers.",
              startAt: start.toISOString(),
              endAt: end.toISOString(),
              htmlLink: "https://calendar.google.com/event?eid=abc",
              meetingUrl: "https://meet.google.com/abc-defg-hij",
              attendeeEmails: ["pratik@example.com", "lead@example.com"],
              organizerEmail: "pratik@example.com",
              eventType: "default",
              eventStatus: "confirmed",
              meetingStatus: "upcoming",
            },
          ],
        }),
      });
    });

    await page.route("**/api/calendar/agenda/start", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          meetingUrl: "https://meet.google.com/abc-defg-hij",
          captureUrl: "/series/10000000-0000-0000-0000-000000000001/meetings/20000000-0000-0000-0000-000000000004",
        }),
      });
    });

    await page.goto("/");
    await waitForApp(page);

    await page.getByRole("button", { name: "Open calendar" }).click();
    const sidebar = page.getByRole("complementary", {
      name: "Calendar sidebar",
    });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText("Product operating review")).toBeVisible();
    await expect(sidebar.getByText("Recurring")).toBeVisible();

    await sidebar.getByRole("button", { name: /Product operating review/ }).click();
    await expect(sidebar.getByText("Review open launch blockers.")).toBeVisible();
    await expect(sidebar.getByText("Google Meet link available")).toBeVisible();

    const popupPromise = page.waitForEvent("popup");
    await sidebar.getByRole("button", { name: "Start meeting" }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL("https://meet.google.com/abc-defg-hij");
    await page.waitForURL(/\/series\/10000000-0000-0000-0000-000000000001\/meetings\/20000000-0000-0000-0000-000000000004/);
  });
});
