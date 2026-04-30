import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, ISSUES, waitForApp } from "./seed-data";

test.describe("Post-meeting summary (MIN-042)", () => {
  test("completed meeting shows summary card with metrics", async ({
    page,
  }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`
    );
    await waitForApp(page);

    await expect(page.getByText("Meeting summary")).toBeVisible();
    await expect(page.getByText("Copy summary")).toBeVisible();
    await expect(page.getByText("Still open")).toBeVisible();
  });

  test("summary card has copy button", async ({ page }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`
    );
    await waitForApp(page);

    const copyBtn = page.getByText("Copy summary");
    await expect(copyBtn).toBeVisible();
  });

  test("upcoming meeting does not show summary card", async ({ page }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup4}`
    );
    await waitForApp(page);

    await expect(page.getByText("Meeting summary")).not.toBeVisible();
  });
});

test.describe("Issue metadata on OIL board (MIN-043)", () => {
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
      /Due (today|tomorrow|in \d+d|May|Jun|Jul|Overdue)/
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

test.describe("Decisions integration (MIN-041)", () => {
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
      page.getByRole("heading", { name: /Items raised/ })
    ).toBeVisible();
  });

  test("guest share meeting view shows decisions", async ({ page }) => {
    await page.goto("/share/test-share-meeting-abc123");
    await waitForApp(page);

    await expect(page.getByText("Items raised")).toBeVisible();
  });
});
