import { test, expect } from "@playwright/test";
import { SERIES, waitForApp } from "./seed-data";

// The seed user owns Platform Team Standup, which has open issues owned by the
// seed user ("Migrate CI from Jenkins to GitHub Actions" is open and assigned to
// Test User). With no SMTP/Resend/Slack/webhook configured the reminder channel
// resolves to clipboard, so the digest markdown lands on the clipboard.
test.describe("One-click reminders", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copies an owner digest to the clipboard when no channel is configured", async ({
    page,
  }) => {
    await page.goto(`/series/${SERIES.platformStandup}`, { waitUntil: "commit" });
    await waitForApp(page);

    const remind = page.getByRole("button", { name: "Remind owners" }).first();
    await expect(remind).toBeVisible();

    await remind.click();

    await expect(page.getByText(/copied|reminder/i).first()).toBeVisible({
      timeout: 10_000,
    });

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("Migrate CI from Jenkins to GitHub Actions");
    expect(clipboard).toContain("Sent via Minutia");
  });
});
