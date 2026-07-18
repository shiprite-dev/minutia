import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, ISSUES, waitForApp } from "./seed-data";
import { groupBySeries } from "./dashboard-helpers";

test.describe("Typography: Fraunces on headings", () => {
  test("app header title uses font-display", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForApp(page);

    const header = page.locator("header h1");
    await expect(header).toBeVisible();
    const fontFamily = await header.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toContain("fraunces");
  });

  test("OIL board section headings use font-display", async ({ page }) => {
    await page.goto("/dashboard");
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
    await page.goto("/dashboard");
    await waitForApp(page);

    const dueLabel = page
      .locator(".font-mono")
      .filter({ hasText: /^(Due|Overdue)/ })
      .first();
    await expect(dueLabel).toBeVisible();
    const fontFamily = await dueLabel.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).toMatch(/jetbrains/i);
  });

  test("update counts use font-mono", async ({ page }) => {
    await page.goto("/dashboard");
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
  test("body text uses Atkinson Hyperlegible Next, not Inter", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForApp(page);

    const body = page.locator("body");
    const fontFamily = await body.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(fontFamily.toLowerCase()).not.toContain("inter");
    expect(fontFamily.toLowerCase()).toContain("hyperlegible");
  });
});

test.describe("Outstanding items collapse", () => {
  // Scope to the Outstanding widget's inline toggle (a <button>); other widgets
  // also use "+N more" but as navigational links, so match by role to disambiguate.
  test("series with >3 items shows expand button", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForApp(page);
    await groupBySeries(page);

    const moreButton = page.getByRole("button", { name: /\+\d+ more/ });
    await expect(moreButton).toBeVisible({ timeout: 10000 });
  });

  test("clicking expand shows all items", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForApp(page);
    await groupBySeries(page);

    const moreButton = page.getByRole("button", { name: /\+\d+ more/ }).first();
    await expect(moreButton).toBeVisible({ timeout: 10000 });
    await moreButton.click();

    await expect(page.getByText("Show less").first()).toBeVisible();
    await expect(moreButton).not.toBeVisible();
  });

  test("clicking show less collapses back", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForApp(page);
    await groupBySeries(page);

    const moreButton = page.getByRole("button", { name: /\+\d+ more/ }).first();
    await expect(moreButton).toBeVisible({ timeout: 10000 });
    await moreButton.click();

    const showLess = page.getByText("Show less").first();
    await expect(showLess).toBeVisible();
    await showLess.click();

    await expect(page.getByRole("button", { name: /\+\d+ more/ }).first()).toBeVisible();
  });

  test("view series link navigates to series detail", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForApp(page);

    await groupBySeries(page);
    const viewSeriesLink = page.getByText("View series").first();
    await expect(viewSeriesLink).toBeVisible({ timeout: 10000 });
    await viewSeriesLink.click();

    await expect(page).toHaveURL(/\/series\//);
  });
});

test.describe("Completed meeting editorial hero", () => {
  const url = `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup2}`;

  test("renders the recap eyebrow and serif meeting title", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(page.getByText("Meeting recap")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Platform Standup #2" })
    ).toBeVisible();
  });

  test("meta row renders the attendee avatar stack", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(page.getByTitle("Alice").first()).toBeVisible();
    await expect(page.getByTitle("Bob").first()).toBeVisible();
  });

  test("renders the numbered tracked-in-the-log section", async ({ page }) => {
    await page.goto(url);
    await waitForApp(page);

    await expect(
      page.getByRole("heading", { name: "Tracked in the log" })
    ).toBeVisible();
    await expect(page.getByText("Items raised").first()).toBeVisible();
  });
});

test.describe("Empty states", () => {
  test("no-actions empty state shows personality text", async ({ page }) => {
    await page.goto("/actions");
    await waitForApp(page);

    const emptyState = page.getByText("You owe nobody anything right now.");
    const firstAction = page.getByRole("button", { name: "Mark done" }).first();

    await Promise.race([
      emptyState.waitFor({ state: "visible" }).catch(() => undefined),
      firstAction.waitFor({ state: "visible" }).catch(() => undefined),
    ]);

    if (await emptyState.isVisible().catch(() => false)) {
      await expect(emptyState).toBeVisible();
      await expect(page.getByText("Keep it that way.")).toBeVisible();
    } else {
      await expect(firstAction).toBeVisible();
    }
  });
});

test.describe("Card cascade animation", () => {
  test("dashboard cards are visible after cascade animation", async ({
    page,
  }) => {
    await page.goto("/dashboard");
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
    await page.goto("/dashboard");
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
    await page.goto("/dashboard");
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
    await page.goto("/dashboard");
    await waitForApp(page);

    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });

    expect(bgColor).not.toBe("rgb(255, 255, 255)");
    expect(bgColor).not.toBe("rgb(0, 0, 0)");
  });
});
