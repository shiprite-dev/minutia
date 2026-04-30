import { test, expect } from "@playwright/test";
import { SHARE_TOKENS, waitForApp } from "./seed-data";

test.describe("Guest Share Pages", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("meeting share renders public view", async ({ page }) => {
    await page.goto(`/share/${SHARE_TOKENS.meeting}`);
    await waitForApp(page);

    await expect(page.getByText(/view-only link/)).toBeVisible();
    await expect(page.getByText("minutia").first()).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Platform Standup #2" })
    ).toBeVisible();

    await expect(page.getByText("Alice").first()).toBeVisible();

    await expect(
      page.getByRole("link", { name: /Star on GitHub/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Try Minutia/i })
    ).toBeVisible();
  });

  test("series share renders public view with open issues", async ({
    page,
  }) => {
    await page.goto(`/share/${SHARE_TOKENS.series}`);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Platform Team Standup" })
    ).toBeVisible();
    await expect(page.getByText(/Open issues/).first()).toBeVisible();
    await expect(page.getByText(/Recent meetings/).first()).toBeVisible();
  });

  test("issue share renders public view with timeline", async ({ page }) => {
    await page.goto(`/share/${SHARE_TOKENS.issue}`);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", {
        name: "Migrate CI from Jenkins to GitHub Actions",
      })
    ).toBeVisible();
    await expect(page.getByText("Action").first()).toBeVisible();
    await expect(page.getByText("High").first()).toBeVisible();
    await expect(page.getByText("Timeline").first()).toBeVisible();
  });

  test("expired share shows expiry error", async ({ page }) => {
    await page.goto(`/share/${SHARE_TOKENS.expired}`);
    await waitForApp(page);

    await expect(page.getByText("Share link expired")).toBeVisible();
    await expect(
      page.getByText("This share link has expired.")
    ).toBeVisible();
  });

  test("invalid share token shows error", async ({ page }) => {
    await page.goto("/share/totally-invalid-token-xyz");
    await waitForApp(page);

    await expect(page.getByText("Invalid share link")).toBeVisible();
  });
});
