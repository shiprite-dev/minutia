import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe("Reduced motion support (MIN-003)", () => {
  test("animations are disabled when prefers-reduced-motion is set", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await waitForApp(page);

    const durations = await page.evaluate(() => {
      const root = document.documentElement;
      const style = getComputedStyle(root);
      return {
        fast: style.getPropertyValue("--duration-fast").trim(),
        base: style.getPropertyValue("--duration-base").trim(),
        slow: style.getPropertyValue("--duration-slow").trim(),
      };
    });

    expect(durations.fast).toBe("0ms");
    expect(durations.base).toBe("0ms");
    expect(durations.slow).toBe("0ms");
  });

  test("CSS transitions complete instantly with reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await waitForApp(page);

    const maxDuration = await page.evaluate(() => {
      let max = 0;
      const elements = document.querySelectorAll("*");
      for (const el of elements) {
        const style = getComputedStyle(el);
        const duration = parseFloat(style.transitionDuration) || 0;
        if (duration > max) max = duration;
      }
      return max;
    });

    expect(maxDuration).toBeLessThanOrEqual(0.01);
  });

  test("page is fully usable without animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await waitForApp(page);

    await expect(page.getByText("Outstanding")).toBeVisible();

    await page.getByRole("link", { name: "Series" }).click();
    await waitForApp(page);
    await expect(page.getByText("Series").first()).toBeVisible();
  });
});
