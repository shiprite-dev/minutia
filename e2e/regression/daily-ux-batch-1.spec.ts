import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  HAS_SERVICE_ROLE,
  createDashboardIssue,
  deleteIssue,
  gotoDashboard,
  outstandingWidget,
  widgetWithText,
} from "./dashboard-helpers";
import { SERIES, waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const rowsSelector = '[data-testid="widget-outstanding-1"] [aria-label*=","]';

test.describe("daily UX batch 1", () => {
  test.skip(!HAS_SERVICE_ROLE, "Requires service role seeding");

  test("a 30-issue board is fully on screen within 600ms of mounting", async ({
    page,
    request,
  }) => {
    const created: string[] = [];
    try {
      for (let i = 0; i < 30; i++) {
        created.push(
          (
            await createDashboardIssue(
              request,
              `Stagger row ${Date.now()}-${i}`,
            )
          ).id,
        );
      }
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      const elapsed = await page.evaluate(async (sel) => {
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        while (document.querySelectorAll(sel).length < 30) await frame();
        const t0 = performance.now();
        const rows = document.querySelectorAll(sel);
        const last = rows[rows.length - 1];
        while (Number(getComputedStyle(last).opacity) < 0.5) await frame();
        return performance.now() - t0;
      }, rowsSelector);
      expect(elapsed).toBeLessThan(600);
    } finally {
      for (const id of created)
        await deleteIssue(request, id).catch(() => undefined);
    }
  });

  test("typing the displayed issue key in the board filter leaves exactly that row", async ({
    page,
  }) => {
    await gotoDashboard(page);
    const keys = await outstandingWidget(page)
      .locator('[aria-label^="Issue key"]')
      .allTextContents();
    const nums = keys
      .map((k) => Number(k.replace("OIL-", "")))
      .filter(Number.isFinite);
    const highest = Math.max(...nums);
    const key = `OIL-${highest}`;

    await page.getByLabel("Filter issues").fill(key);

    const rows = page.locator(rowsSelector);
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByLabel(`Issue key ${key}`)).toBeVisible();
  });

  test.describe("an item due today", () => {
    test.use({ timezoneId: "Asia/Tokyo" });

    test("is not counted overdue anywhere in Tokyo time", async ({
      page,
      request,
    }) => {
      await page.clock.setFixedTime(new Date("2026-11-18T10:00:00Z"));
      await gotoDashboard(page);
      const hero = widgetWithText(page, "Open items across your series");
      const overdueCount = async () => {
        const text =
          (await hero
            .getByText(/\d+ overdue/)
            .textContent({ timeout: 1000 })
            .catch(() => null)) ?? "0";
        return Number(text.match(/\d+/)?.[0] ?? 0);
      };
      const before = await overdueCount();

      const title = `Due today Tokyo ${Date.now()}`;
      const { id } = await createDashboardIssue(request, title, {
        due_date: "2026-11-18",
      });
      try {
        await page.reload();
        await waitForApp(page);
        const row = page.locator(rowsSelector).filter({ hasText: title });
        await expect(row).toBeVisible();
        await expect(row).toContainText("Due today");
        await expect(row).not.toHaveAttribute("aria-label", /overdue/);
        expect(await overdueCount()).toBe(before);
      } finally {
        await deleteIssue(request, id);
      }
    });
  });

  test("the board labels say what they show", async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.getByText(/avg life/i)).toHaveCount(0);
    await expect(page.getByText("from last meeting")).toHaveCount(0);
    await expect(page.getByText("Next meeting")).toHaveCount(0);
    await expect(page.getByText("Latest series").first()).toBeVisible();
    await expect(page.getByText(/raised per open item/).first()).toBeVisible();
  });

  test("Esc in live capture clears the typed text", async ({
    page,
    request,
  }) => {
    const seriesId = randomUUID();
    const meetingId = randomUUID();
    const headers = {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };
    const post = (path: string, data: unknown) =>
      request.post(`${SUPABASE_URL}/rest/v1/${path}`, { headers, data });
    const owner = await (
      await request.get(
        `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${SERIES.platformStandup}&select=owner_id`,
        {
          headers,
        },
      )
    ).json();
    try {
      expect(
        (
          await post("meeting_series", {
            id: seriesId,
            name: `Esc capture ${Date.now()}`,
            cadence: "weekly",
            owner_id: owner[0].owner_id,
          })
        ).ok(),
      ).toBeTruthy();
      expect(
        (
          await post("meetings", {
            id: meetingId,
            series_id: seriesId,
            sequence_number: 1,
            title: "Esc capture",
            date: "2026-11-18",
            attendees: [],
            status: "upcoming",
            notes_markdown: "",
          })
        ).ok(),
      ).toBeTruthy();

      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);
      await page.getByRole("button", { name: "Start meeting" }).click();

      const input = page.getByLabel("Capture input");
      await input.fill("half typed thought");
      await page.keyboard.press("Escape");
      await expect(input).toHaveValue("");
    } finally {
      await request.delete(
        `${SUPABASE_URL}/rest/v1/meeting_series?id=eq.${seriesId}`,
        { headers },
      );
    }
  });
});
