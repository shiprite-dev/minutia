import { test, expect } from "@playwright/test";
import { SERIES, waitForApp } from "./seed-data";

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

// Canvas bounds: a busy meeting group shows at most 2 issues until expanded, so
// the timeline never stretches unbounded.
test.describe("Canvas bounds: issues per meeting", () => {
  test("issues are capped at 2 with a Show all control that expands in place", async ({
    page,
  }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    const showAll = page.getByRole("button", { name: /Show all \d+ items/ }).first();
    await expect(showAll).toBeVisible();

    // The group is collapsed to exactly the 2-item preview.
    const group = showAll.locator("xpath=..");
    const rows = group.locator("a[href*='/issues/']");
    await expect(rows).toHaveCount(2);

    // Expanding reveals the rest in place (no navigation to a separate page).
    await showAll.click();
    await expect(rows).not.toHaveCount(2);
  });
});
