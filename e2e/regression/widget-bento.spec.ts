import { test, expect, type Page } from "@playwright/test";
import { waitForApp } from "./seed-data";

// Contract for the dnd-kit + CSS Grid bento dashboard that replaces GridStack.
//
// The decisive gate is "no widget clips its content" (the GridStack bug), plus
// a full-page screenshot for human/visual review.

const DEFAULT_COL_SPANS: Record<string, string> = {
  "hero-1": "2",
  "next-meeting-1": "1",
  "outstanding-1": "4",
  "series-1": "1",
  "decisions-1": "1",
  "age-1": "1",
};

async function gotoFreshDashboard(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem("minutia-widgets");
  });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await expect(page.getByRole("button", { name: "Add widget" })).toBeVisible();
}

test.describe("Widget bento canvas", () => {
  test("canvas renders with the CSS Grid engine (no gridstack)", async ({ page }) => {
    await gotoFreshDashboard(page);
    const canvas = page.getByTestId("dashboard-widget-canvas");
    await expect(canvas).toHaveAttribute("data-grid-engine", "css-grid");
    await expect(page.locator(".grid-stack")).toHaveCount(0);
  });

  test("each default widget carries its footprint col-span", async ({ page }) => {
    await gotoFreshDashboard(page);
    for (const [id, span] of Object.entries(DEFAULT_COL_SPANS)) {
      await expect(page.getByTestId(`widget-${id}`)).toHaveAttribute("data-col-span", span);
    }
  });

  test("no widget clips its content behind an internal scrollbar", async ({ page }) => {
    await gotoFreshDashboard(page);
    await expect(page.getByTestId("widget-outstanding-1")).toBeVisible();

    // Scan every widget for a vertical clipping container whose content is
    // taller than its box. This is exactly the GridStack failure mode
    // (.grid-stack-item-content with overflow + fixed height).
    const clipped = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll<HTMLElement>("[data-testid^='widget-']").forEach((widget) => {
        const id = widget.getAttribute("data-testid");
        widget.querySelectorAll<HTMLElement>("*").forEach((el) => {
          const oy = getComputedStyle(el).overflowY;
          const clips = oy === "auto" || oy === "scroll" || oy === "hidden";
          if (clips && el.scrollHeight > el.clientHeight + 1) {
            out.push(`${id}: ${el.scrollHeight}>${el.clientHeight}`);
          }
        });
      });
      return out;
    });
    expect(clipped).toEqual([]);

    // All default widgets present (not just the top band) before the shot.
    for (const id of Object.keys(DEFAULT_COL_SPANS)) {
      await expect(page.getByTestId(`widget-${id}`)).toBeVisible();
    }
    await page.waitForTimeout(800); // let staggered entrance animations settle
    await page.screenshot({ path: "test-results/dashboard-bento.png", fullPage: true });
  });

  test("outstanding spans the full width", async ({ page }) => {
    await gotoFreshDashboard(page);
    const outstanding = page.getByTestId("widget-outstanding-1");
    await expect(outstanding).toHaveAttribute("data-col-span", "4");
    const box = await outstanding.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(1000);
  });
});
