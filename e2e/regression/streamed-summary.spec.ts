import { test, expect, type Page } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SERIES_ID = "10000000-0000-0000-0000-000000000004";
const MEETING_ID = "20000000-0000-0000-0000-000000000030";
const STREAM_URL = `**/api/meetings/${MEETING_ID}/summary/stream`;
const HAS_AI = !!(process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY);

function sseBody(words: string[]): string {
  const frames = words.map((w) => `data: ${JSON.stringify({ t: w })}\n\n`);
  return `:\n\n${frames.join("")}data: [DONE]\n\n`;
}

async function gotoMeeting(page: Page) {
  await page.goto(`/series/${SERIES_ID}/meetings/${MEETING_ID}`);
  await waitForApp(page);
}

test("generates a recap that renders as flowing words and announces completion once", async ({ page }) => {
  await page.route(STREAM_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
      body: sseBody(["Mike ", "Ross ", "owns ", "the ", "migration ", "review."]),
    })
  );
  await gotoMeeting(page);

  await page.getByRole("button", { name: /generate recap/i }).click();

  const summary = page.locator("[data-flowing-summary]").first();
  await expect(summary).toContainText("Mike Ross owns the migration review.");
  // Rendered as per-word spans, not one text node.
  expect(await summary.locator("span").count()).toBeGreaterThan(3);

  // The polite completion region is populated exactly once.
  const announce = page.locator("span[aria-live='polite']").filter({ hasText: "Summary ready" });
  await expect(announce).toHaveCount(1);
});

test("Stop halts an in-flight recap without losing arrived text", async ({ page }) => {
  // A stream that never completes so the Stop control is meaningful.
  await page.route(STREAM_URL, async (route) => {
    await new Promise((r) => setTimeout(r, 30_000));
    await route.abort();
  });
  await gotoMeeting(page);

  await page.getByRole("button", { name: /generate recap/i }).click();
  const stop = page.getByRole("button", { name: /stop/i });
  await expect(stop).toBeVisible();
  await stop.click();

  // After Stop, the generating affordance is gone and the Generate control returns.
  await expect(page.getByText(/generating recap/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /generate recap|regenerate recap/i })).toBeVisible();
});

test("reduced motion disables the enter animation while words still render", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(STREAM_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
      body: sseBody(["Recap ", "text ", "still ", "appears."]),
    })
  );
  await gotoMeeting(page);

  await page.getByRole("button", { name: /generate recap/i }).click();
  const summary = page.locator("[data-flowing-summary]").first();
  await expect(summary).toContainText("Recap text still appears.");

  const animationName = await summary
    .locator("span")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animationName === "none" || animationName === "").toBeTruthy();
});

test("deep token streaming grows the recap incrementally (live provider only)", async ({ page }) => {
  test.skip(!HAS_AI, "Requires a live AI provider (OPENROUTER_API_KEY / AI_API_KEY) for true token streaming.");
  await gotoMeeting(page);
  await page.getByRole("button", { name: /generate recap/i }).click();

  const summary = page.locator("[data-flowing-summary]").first();
  await expect(summary).toBeVisible();
  const first = (await summary.textContent())?.length ?? 0;
  await expect
    .poll(async () => (await summary.textContent())?.length ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(first);
  await expect(page.locator("span[aria-live='polite']").filter({ hasText: "Summary ready" }))
    .toHaveCount(1, { timeout: 30_000 });
});
