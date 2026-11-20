import { test, expect, type Page } from "@playwright/test";
import { MEETINGS, SERIES, waitForApp } from "./seed-data";

// Accuracy and diarization journey. The seeded meeting has a real diarized
// transcript (transcript_diarized=true, speaker_map, transcript_segments) and
// a self-assignment ("I will take the migration review"). The corresponding
// meeting_ai_suggestions row is seeded rather than live-extracted, so the
// owner-attribution render is deterministic in CI without an AI key; the
// live AssemblyAI extraction path is validated separately in the accuracy
// spike (see .superpowers/sdd/task-11-brief.md).

async function gotoDiarizedMeeting(page: Page) {
  await page.goto(`/series/${SERIES.diarizationQa}/meetings/${MEETINGS.diarizedSync}`);
  await waitForApp(page);
  await expect(page.getByRole("heading", { name: "Diarized Sync" })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("Diarized transcript", () => {
  test("shows speaker chips and attributes the owner suggestion", async ({ page }) => {
    await gotoDiarizedMeeting(page);

    // Speaker turns render with resolved names, not "Speaker A" / "Speaker B",
    // once the collapsed transcript is opened.
    const transcriptToggle = page.getByRole("button", { name: /^Transcript/ });
    await expect(transcriptToggle).toHaveAttribute("aria-expanded", "false");
    await transcriptToggle.click();
    await expect(
      page.getByRole("button", { name: "Rename Speaker A, currently Sarah Lee" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Rename Speaker B, currently Mike Ross" }).first()
    ).toBeVisible();
    const turnBy = (speaker: string, line: string) =>
      page
        .locator("div")
        .filter({ has: page.getByRole("button", { name: speaker, exact: true }) })
        .filter({ has: page.getByText(line, { exact: true }) })
        .last();
    await expect(
      turnBy("Rename Speaker A, currently Sarah Lee", "We still need the migration reviewed.")
    ).toBeVisible();
    await expect(
      turnBy("Rename Speaker B, currently Mike Ross", "I will take the migration review.")
    ).toBeVisible();

    // The self-assignment in the transcript surfaces as an owner-attributed
    // suggestion, already open in the log's review group with no click.
    await expect(page.getByRole("button", { name: /Review AI suggestions/ })).toHaveCount(0);
    const region = page.getByRole("region", { name: "AI suggestions" });
    await expect(region).toBeVisible();

    const card = page
      .locator("[data-suggestion-card]")
      .filter({ hasText: "migration review" })
      .first();
    await expect(card).toBeVisible();
    // Title and owner render as editable inputs (new_item suggestions stay
    // fully editable), so assert their value rather than text content.
    await expect(card.getByLabel("Suggestion owner")).toHaveValue("Mike Ross");
  });

  test("suggestion cards skip the materialize animation under reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoDiarizedMeeting(page);

    const card = page
      .locator("[data-suggestion-card]")
      .filter({ hasText: "migration review" })
      .first();
    await expect(card).toBeVisible();

    const animationName = await card.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe("none");
  });

  // A manager-rename step (chip edit -> PATCH /api/meetings/:id/speaker-map)
  // is intentionally not covered here: that route re-runs AI extraction
  // server-side, so it depends on a live AI key and would make this journey
  // flaky in CI shards that run without one. The rename path is exercised
  // manually in the accuracy spike alongside live diarization accuracy.
});
