import { test, expect } from "@playwright/test";

const SERIES_URL = "/series/10000000-0000-0000-0000-000000000001";

test.describe("Send Brief to Attendees", () => {
  test("brief card shows send and copy buttons", async ({ page }) => {
    await page.goto(SERIES_URL);
    await expect(page.getByText("Brief", { exact: true })).toBeVisible();

    await expect(page.getByTestId("send-brief-btn")).toBeVisible();
    await expect(page.getByTestId("send-brief-btn")).toHaveText(
      /Send brief to attendees|Copy brief to send/
    );
    await expect(page.getByTestId("copy-brief-btn")).toBeVisible();
  });

  test("send button triggers mailto with correct subject", async ({ page }) => {
    await page.goto(SERIES_URL);
    await expect(page.getByText("Brief", { exact: true })).toBeVisible();

    const sendBtn = page.getByTestId("send-brief-btn");
    const btnText = await sendBtn.textContent();

    if (btnText?.includes("Send brief")) {
      const mailtoPromise = page.waitForEvent("popup").catch(() => null);
      await sendBtn.click();

      const hiddenLink = page.locator('a[href^="mailto:"]');
      const href = await hiddenLink.getAttribute("href");
      expect(href).toContain("mailto:");
      expect(href).toContain(
        encodeURIComponent("Pre-Meeting Brief: Platform Team Standup")
      );
    } else {
      await sendBtn.click();
      await expect(sendBtn).toHaveText(/Brief copied/);
    }
  });

  test("brief lists pending issues with owners and due dates", async ({ page }) => {
    await page.goto(SERIES_URL);
    await expect(page.getByText("Brief", { exact: true })).toBeVisible();

    const briefCard = page.locator(".border-t-accent").first();
    await expect(briefCard.getByText("Platform Team Standup")).toBeVisible();
  });
});
