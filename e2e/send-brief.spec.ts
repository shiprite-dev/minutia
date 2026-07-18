import { test, expect, type Page } from "@playwright/test";

const SERIES_URL = "/series/10000000-0000-0000-0000-000000000001";

test.describe.configure({ mode: "serial" });

async function gotoSeriesBrief(page: Page) {
  await page.goto(SERIES_URL, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Platform Team Standup" }).first()
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Brief", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("Brief card", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("shows Email brief and Copy actions", async ({ page }) => {
    await gotoSeriesBrief(page);

    await expect(page.getByTestId("send-brief-btn")).toHaveText(/Email brief/);
    await expect(page.getByTestId("copy-brief-btn")).toBeVisible();
  });

  test("email brief with no attendee emails surfaces a guidance notice", async ({
    page,
  }) => {
    await gotoSeriesBrief(page);

    // Seed attendees are bare names, so there are no deliverable addresses.
    await page.getByTestId("send-brief-btn").click();
    await expect(page.getByTestId("brief-notice")).toContainText(
      /No attendee emails/
    );
  });

  test("copy brief includes the guest live-log link", async ({ page }) => {
    await gotoSeriesBrief(page);

    await page.getByTestId("copy-brief-btn").click();
    await expect(page.getByTestId("copy-brief-btn")).toContainText(/Copied/);

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("See the live log:");
    expect(clip).toContain("/share/");
  });
});
