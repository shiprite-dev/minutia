import { test, expect } from "@playwright/test";

const SERIES_URL = "/series/10000000-0000-0000-0000-000000000001";

test.describe("Send Brief to Attendees", () => {
  test("brief card shows send and copy buttons", async ({ page }) => {
    await page.goto(SERIES_URL);
    await expect(page.getByText("Brief", { exact: true })).toBeVisible();

    await expect(page.getByTestId("send-brief-btn")).toBeVisible();
    await expect(page.getByTestId("send-brief-btn")).toHaveText(/Send brief to attendees/);
    await expect(page.getByTestId("copy-brief-btn")).toBeVisible();
  });

  test("copy button copies brief text to clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(SERIES_URL);
    await expect(page.getByText("Brief", { exact: true })).toBeVisible();

    await page.getByTestId("copy-brief-btn").click();

    // Button should show "Copied" feedback
    await expect(page.getByTestId("copy-brief-btn")).toHaveText(/Copied/);

    // Verify clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain("Pre-Meeting Brief: Platform Team Standup");
    expect(clipboardText).toContain("Sent via Minutia");
  });

  test("send button triggers mailto with correct subject", async ({ page }) => {
    await page.goto(SERIES_URL);
    await expect(page.getByText("Brief", { exact: true })).toBeVisible();

    // Intercept window.open to capture the mailto URL
    const mailtoUrl = await page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const original = window.open;
        window.open = (url: any) => {
          resolve(String(url));
          window.open = original;
          return null;
        };
        const btn = document.querySelector('[data-testid="send-brief-btn"]') as HTMLButtonElement;
        btn.click();
      });
    });

    expect(mailtoUrl).toContain("mailto:");
    expect(mailtoUrl).toContain("Alice");
    expect(mailtoUrl).toContain("Bob");
    expect(mailtoUrl).toContain("Carol");
    expect(mailtoUrl).toContain(encodeURIComponent("Pre-Meeting Brief: Platform Team Standup"));
  });

  test("brief lists pending issues with owners and due dates", async ({ page }) => {
    await page.goto(SERIES_URL);
    await expect(page.getByText("Brief", { exact: true })).toBeVisible();

    const briefCard = page.locator(".border-t-accent").first();
    await expect(briefCard.getByText("Platform Team Standup")).toBeVisible();
    await expect(briefCard.getByText(/Alice|Bob|Carol|Dana/).first()).toBeVisible();
  });
});
