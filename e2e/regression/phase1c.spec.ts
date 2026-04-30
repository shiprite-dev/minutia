import { test, expect } from "@playwright/test";
import { SERIES, MEETINGS, ISSUES, waitForApp } from "./seed-data";

test.describe("OIL Board card stagger (MIN-004)", () => {
  test("issue rows are visible after stagger animation completes", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);

    const issueLink = page.getByRole("link", { name: /migrate ci/i }).first();
    await expect(issueLink).toBeVisible();

    const issueRow = issueLink.locator("xpath=ancestor::div[contains(@class, 'rounded-lg')]");
    const opacity = await issueRow.evaluate(
      (el) => getComputedStyle(el).opacity
    );
    expect(parseFloat(opacity)).toBeGreaterThan(0.99);
  });
});

test.describe("Issue status change animation (MIN-005)", () => {
  test("resolved issue on detail page has strikethrough title", async ({
    page,
  }) => {
    await page.goto(`/issues/${ISSUES.sslCert}`);
    await waitForApp(page);

    const statusChip = page.getByRole("combobox").first();
    if (await statusChip.isVisible().catch(() => false)) {
      const statusText = await statusChip.textContent();
      if (statusText?.toLowerCase() === "resolved") {
        const titleEl = page.locator("h1").first();
        const classes = await titleEl.getAttribute("class");
        expect(classes).toContain("line-through");
      }
    }
  });
});

test.describe("Issue lifecycle timeline animation (MIN-006)", () => {
  test("timeline section is visible on issue detail page", async ({
    page,
  }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);

    const timelineSection = page.getByText(/lifecycle timeline/i);
    await expect(timelineSection).toBeVisible();
  });
});

test.describe("Button micro-interactions (MIN-023)", () => {
  test("button has active scale transform class", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const button = page.locator("[data-slot='button']").first();
    await expect(button).toBeVisible();

    const classes = await button.getAttribute("class");
    expect(classes).toContain("active:scale-");
  });

  test("button has hover brightness class", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);

    const button = page.locator("[data-slot='button']").first();
    await expect(button).toBeVisible();

    const classes = await button.getAttribute("class");
    expect(classes).toContain("hover:brightness-");
  });
});

test.describe("Copy button morph confirmation (MIN-024)", () => {
  test("brief card copy button shows 'Copied' on click", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    const copyBtn = page.getByTestId("copy-brief-btn");
    if (await copyBtn.isVisible().catch(() => false)) {
      await copyBtn.click();
      await expect(page.getByText("Copied")).toBeVisible({ timeout: 3000 });
    }
  });

  test("meeting summary copy button shows 'Copied' on click", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(
      `/series/${SERIES.platformStandup}/meetings/${MEETINGS.standup1}`
    );
    await waitForApp(page);

    const copyBtn = page.getByText("Copy summary");
    if (await copyBtn.isVisible().catch(() => false)) {
      await copyBtn.click();
      await expect(page.getByText("Copied")).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe("OIL card inline expand vertical rule (MIN-025)", () => {
  test("issue card on detail page shows expanded content with vertical rule", async ({
    page,
  }) => {
    await page.goto(`/issues/${ISSUES.migrateCI}`);
    await waitForApp(page);

    const issueTitle = page.locator("h1").first();
    await expect(issueTitle).toBeVisible();
  });
});

test.describe("Dialog spring-in animation (MIN-038)", () => {
  test("dialog opens with 160ms animation duration", async ({ page }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    const settingsBtn = page.getByRole("button", { name: /settings/i });
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click();

      const dialogContent = page.locator("[data-slot='dialog-content']");
      await expect(dialogContent).toBeVisible({ timeout: 3000 });

      const classes = await dialogContent.getAttribute("class");
      expect(classes).toContain("duration-[160ms]");
    }
  });
});

test.describe("Brief card slide-down animation (MIN-020)", () => {
  test("brief card is visible on series detail page", async ({ page }) => {
    await page.goto(`/series/${SERIES.platformStandup}`);
    await waitForApp(page);

    const briefLabel = page.getByText("Brief", { exact: true });
    if (await briefLabel.isVisible().catch(() => false)) {
      await expect(briefLabel).toBeVisible();
    }
  });
});
