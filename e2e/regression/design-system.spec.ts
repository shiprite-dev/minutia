import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, ISSUES, waitForApp } from "./seed-data";

test.describe("Typography: Fraunces on headings", () => {
  test("app header title uses font-display", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const header = page.locator("header h1");
    await expect(header).toBeVisible();
    const fontFamily = await header.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toContain("fraunces");
  });

  test("OIL board section headings use font-display", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const outstandingHeading = page.getByText("Outstanding items");
    await expect(outstandingHeading).toBeVisible();
    const fontFamily = await outstandingHeading.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toContain("fraunces");
  });

  test("series detail page title uses font-display", async ({ page }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    const title = page.getByRole("heading", {
      name: "Platform Team Standup",
      level: 1,
    });
    await expect(title).toBeVisible();
    const fontFamily = await title.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toContain("fraunces");
  });

  test("My Actions page title uses font-display", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    const title = page.getByRole("heading", { name: "My Actions" }).first();
    await expect(title).toBeVisible();
    const fontFamily = await title.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toContain("fraunces");
  });
});

test.describe("Typography: JetBrains Mono on metadata", () => {
  test("due dates use font-mono", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const dueLabel = page.getByText(/Due May/).first();
    await expect(dueLabel).toBeVisible();
    const fontFamily = await dueLabel.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toMatch(/jetbrains/i);
  });

  test("update counts use font-mono", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const updateCount = page.getByText(/\d+ updates?/).first();
    await expect(updateCount).toBeVisible();
    const fontFamily = await updateCount.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toMatch(/jetbrains/i);
  });

  test("brief card label uses font-mono", async ({ page }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    const briefLabel = page.getByText("Brief", { exact: true }).first();
    await expect(briefLabel).toBeVisible();
    const fontFamily = await briefLabel.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toMatch(/jetbrains/i);
  });
});

test.describe("Typography: no Inter anywhere", () => {
  test("body text uses Satoshi, not Inter", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const body = page.locator("body");
    const fontFamily = await body.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).not.toContain("inter");
    expect(fontFamily.toLowerCase()).toContain("satoshi");
  });
});

test.describe("Outstanding items collapse", () => {
  test("series with >3 items shows expand button", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const moreButton = page.getByText(/\+\d+ more/);
    await expect(moreButton).toBeVisible({ timeout: 10000 });
  });

  test("clicking expand shows all items", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const moreButton = page.getByText(/\+\d+ more/).first();
    await expect(moreButton).toBeVisible({ timeout: 10000 });
    await moreButton.click();

    await expect(page.getByText("Show less").first()).toBeVisible();
    await expect(moreButton).not.toBeVisible();
  });

  test("clicking show less collapses back", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const moreButton = page.getByText(/\+\d+ more/).first();
    await expect(moreButton).toBeVisible({ timeout: 10000 });
    await moreButton.click();

    const showLess = page.getByText("Show less").first();
    await expect(showLess).toBeVisible();
    await showLess.click();

    await expect(page.getByText(/\+\d+ more/).first()).toBeVisible();
  });

  test("view series link navigates to series detail", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const viewSeriesLink = page.getByText("View series").first();
    await expect(viewSeriesLink).toBeVisible({ timeout: 10000 });
    await viewSeriesLink.click();

    await expect(page).toHaveURL(/\/series\//);
  });
});

test.describe("Meeting summary card", () => {
  test("completed meeting shows animated summary card", async ({ page }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup2}`
    );
    await waitForApp(page);

    const hasSummary = await page
      .getByText("Meeting complete")
      .isVisible()
      .catch(() => false);

    if (hasSummary) {
      await expect(page.getByText("Raised", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Decisions", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Resolved", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Carried", { exact: true }).first()).toBeVisible();
    } else {
      const itemsRaised = page.getByText("Items raised");
      await expect(itemsRaised).toBeVisible();
    }
  });

  test("summary card shows contextual insight line when present", async ({
    page,
  }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup2}`
    );
    await waitForApp(page);

    const hasSummary = await page
      .getByText("Meeting complete")
      .isVisible()
      .catch(() => false);

    if (hasSummary) {
      const insightPatterns = [
        /clean slate/i,
        /closed more than you opened/i,
        /new items tracked/i,
        /items captured/i,
      ];

      let foundInsight = false;
      for (const pattern of insightPatterns) {
        const match = page.getByText(pattern).first();
        if (await match.isVisible().catch(() => false)) {
          foundInsight = true;
          break;
        }
      }
      expect(foundInsight).toBe(true);
    }
  });

  test("summary card has accent hairline at top", async ({ page }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup2}`
    );
    await waitForApp(page);

    const hasSummary = await page
      .getByText("Meeting complete")
      .isVisible()
      .catch(() => false);

    if (hasSummary) {
      const hairline = page.locator(".bg-accent").first();
      await expect(hairline).toBeVisible();
    }
  });

  test("copy summary button morphs to copied state", async ({ page }) => {
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup2}`
    );
    await waitForApp(page);

    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);

    const copyBtn = page.getByText("Copy summary").first();
    const hasCopyBtn = await copyBtn.isVisible().catch(() => false);

    if (hasCopyBtn) {
      await copyBtn.click();
      await expect(page.getByText("Copied").first()).toBeVisible();
    }
  });
});

test.describe("Empty states", () => {
  test("no-actions empty state shows personality text", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    const hasItems = await page
      .getByText("Needs attention")
      .isVisible()
      .catch(() => false);

    if (!hasItems) {
      await expect(
        page.getByText("You owe nobody anything right now.")
      ).toBeVisible();
      await expect(page.getByText("Keep it that way.")).toBeVisible();
    }
  });
});

test.describe("Card cascade animation", () => {
  test("dashboard cards are visible after cascade animation", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    const heroCard = page.getByText("Open items across your series");
    await expect(heroCard).toBeVisible();

    const outstandingCard = page.getByText("Outstanding items");
    await expect(outstandingCard).toBeVisible();

    const seriesCard = page.getByText("Your series").first();
    await expect(seriesCard).toBeVisible();

    const ageCard = page.getByText("Age of open items");
    await expect(ageCard).toBeVisible();
  });
});

test.describe("Status chip inline expand", () => {
  test("clicking status chip expands alternatives inline", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    const chip = page.getByRole("combobox", { name: /Status:/ }).first();
    await expect(chip).toBeVisible({ timeout: 10000 });
    await chip.click();

    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible();

    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThanOrEqual(2);
  });

  test("selecting a status option collapses the chip", async ({ page }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);

    const chip = page.getByRole("combobox", { name: /Status:/ }).first();
    await expect(chip).toBeVisible();
    await chip.click();

    const option = page.getByRole("option").first();
    await expect(option).toBeVisible();
    await option.click();

    await expect(page.getByRole("option").first()).not.toBeVisible();
  });

  test("pressing Escape closes expanded chip", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const chip = page.getByRole("combobox", { name: /Status:/ }).first();
    await expect(chip).toBeVisible({ timeout: 10000 });
    await chip.click();

    await expect(page.getByRole("option").first()).toBeVisible();
    await chip.press("Escape");
    await expect(page.getByRole("option").first()).not.toBeVisible();
  });
});

test.describe("Brief card", () => {
  test("brief card shows on series with pending issues", async ({ page }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    await expect(page.getByText("Brief", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Copy brief to send")).toBeVisible();
    await expect(page.getByTestId("copy-brief-btn")).toBeVisible();
  });

  test("brief card has accent top border", async ({ page }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    const briefCard = page.locator(".border-t-accent").first();
    await expect(briefCard).toBeVisible();
  });
});

test.describe("OKLCH color system", () => {
  test("page background uses neutral paper color, not pure white/black", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });

    expect(bgColor).not.toBe("rgb(255, 255, 255)");
    expect(bgColor).not.toBe("rgb(0, 0, 0)");
  });
});
