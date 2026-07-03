import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, ISSUES, waitForApp } from "./seed-data";

test.describe("Post-meeting summary", () => {
  test("completed meeting shows the editorial recap hero", async ({
    page,
  }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`
    );
    await waitForApp(page);

    await expect(page.getByText("Meeting recap")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Platform Standup #1" })
    ).toBeVisible();
  });

  test("completed meeting shows the tracked log section", async ({ page }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`
    );
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Tracked in the log" })
    ).toBeVisible();
    await expect(page.getByText("Items raised").first()).toBeVisible();
  });

  test("upcoming meeting does not show the recap hero", async ({ page }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup4}`
    );
    await waitForApp(page);

    await expect(page.getByText("Meeting recap")).not.toBeVisible();
  });
});

test.describe("Issue metadata on OIL board", () => {
  test("issue with updates shows update count on OIL board", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    const updateBadge = page.getByText(/\d+ updates?/).first();
    await expect(updateBadge).toBeVisible();
  });

  test("issue with due date shows relative due label", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const dueDatePattern = page.getByText(
      /Overdue by \d+d|Due (today|tomorrow|in \d+d|May|Jun|Jul)/
    );
    await expect(dueDatePattern.first()).toBeVisible();
  });

  test("issue detail shows duration and meetings touched", async ({
    page,
  }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);

    await expect(page.getByText(/\d+ days?/)).toBeVisible();
    await expect(page.getByText(/\d+ meetings?/)).toBeVisible();
  });
});

test.describe("Decisions integration", () => {
  test("OIL board sidebar shows recent decisions card", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await expect(page.getByText("Recent decisions")).toBeVisible();
  });

  test("command palette includes decisions group", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(300);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText("Decisions")).toBeVisible();
  });

  test("completed meeting shows decisions section", async ({ page }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`
    );
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Tracked in the log" })
    ).toBeVisible();
  });

  test("guest share meeting view shows decisions", async ({ page }) => {
    await page.goto("/share/test-share-meeting-abc123");
    await waitForApp(page);

    await expect(page.getByText("Items raised")).toBeVisible();
  });
});
