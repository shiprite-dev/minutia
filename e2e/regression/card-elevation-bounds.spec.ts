import { test, expect } from "@playwright/test";
import { SERIES, waitForApp } from "./seed-data";
import { createDashboardIssue, deleteIssue, HAS_SERVICE_ROLE } from "./dashboard-helpers";

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
    try {
      const stamp = Date.now();
      for (let i = 0; i < 3; i++) {
        created.push(await createDashboardIssue(request, `Bounds cap ${i} ${stamp}`));
      }

      await page.goto(`/series/${SERIES.platformStandup}`);
      await waitForApp(page);

      // The most recent meeting auto-expands; it now raises exactly 3 issues, so
      // its "Issues (3)" group is the stable anchor (it survives expansion, unlike
      // the Show-all button which disappears once clicked).
      const group = page.getByText("Issues (3)", { exact: true }).locator("..");
      const rows = group.locator("a[href*='/issues/']");
      await expect(group.getByRole("button", { name: /Show all 3 items/ })).toBeVisible();
      await expect(rows).toHaveCount(2);

      // Expanding reveals the rest in place (no navigation to a separate page).
      await group.getByRole("button", { name: /Show all 3 items/ }).click();
      await expect(rows).toHaveCount(3);
    } finally {
      for (const issue of created) await deleteIssue(request, issue.id);
    }
  });
});
