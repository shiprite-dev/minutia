import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";
import {
  addWidget,
  createDashboardIssue,
  deleteIssue,
  HAS_SERVICE_ROLE,
  openWidgetPicker,
  widgetWithText,
} from "./dashboard-helpers";

test.describe("Widget system", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("minutia-widgets"));
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
  });

  test("dashboard renders default widgets on fresh state", async ({ page }) => {
    await expect(page.getByText("Open items across your series")).toBeVisible();
    await expect(page.getByText("Outstanding items")).toBeVisible();
    await expect(page.getByText("Your series").first()).toBeVisible();
    await expect(page.getByText("Recent decisions")).toBeVisible();
    await expect(page.getByText("Age of open items")).toBeVisible();
  });

  test("add widget button opens picker with groups", async ({ page }) => {
    await openWidgetPicker(page);

    await expect(page.getByText("Widgets")).toBeVisible();
    await expect(page.getByText("Health", { exact: true })).toBeVisible();
    await expect(page.getByText("Meeting", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("People", { exact: true }).first()).toBeVisible();
  });

  test("default widgets show as disabled in picker", async ({ page }) => {
    await openWidgetPicker(page);

    const summaryBtn = page.getByRole("button", { name: /Summary.*added/ });
    await expect(summaryBtn).toBeVisible();
    await expect(summaryBtn).toBeDisabled();
  });

  test("can add stale items widget from picker", async ({ page }) => {
    await addWidget(page, /Stale Items/);

    await expect(page.getByText("Needs attention")).toBeVisible();
  });

  test("stale items widget links to the oldest stale issue", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "SUPABASE_SERVICE_ROLE_KEY is required for isolated stale item data");

    const staleIssue = await createDashboardIssue(
      request,
      `Stale dashboard link ${Date.now()}`,
      { updated_at: "2026-04-01T00:00:00Z" }
    );

    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForApp(page);
      await addWidget(page, /Stale Items/);

      await widgetWithText(page, "Needs attention")
        .getByRole("link", { name: staleIssue.title })
        .click();
      await expect(page).toHaveURL(new RegExp(`/issues/${staleIssue.id}`));
      await expect(page.getByText(staleIssue.title).first()).toBeVisible();
    } finally {
      await deleteIssue(request, staleIssue.id);
    }
  });

  test("can add series health widget with distribution legend", async ({ page }) => {
    await addWidget(page, /Series Health/);

    const health = widgetWithText(page, "Series health");
    await expect(health.getByRole("heading", { name: "Series health" })).toBeVisible();
    await expect(health.getByText("Status distribution")).toBeVisible();
    await expect(health.getByText("Open", { exact: true })).toBeVisible();
    await expect(health.getByText("In Progress / Pending")).toBeVisible();
    await expect(health.getByText("Resolved", { exact: true })).toBeVisible();
  });

  test("series health widget opens a series", async ({ page }) => {
    await addWidget(page, /Series Health/);

    await widgetWithText(page, "Series health").getByRole("link", { name: "Platform Team Standup" }).click();
    await expect(page).toHaveURL(/\/series\/[0-9a-f-]+/);
  });

  test("can add meeting triage widget", async ({ page }) => {
    await addWidget(page, /Meeting Triage/);

    await expect(page.getByRole("heading", { name: "Meeting triage" })).toBeVisible();
    await expect(page.getByText("Carried").first()).toBeVisible();
    await expect(page.getByText("New since last").first()).toBeVisible();
  });

  test("can add workload widget", async ({ page }) => {
    await addWidget(page, /Workload.*Open items/);

    await expect(page.getByRole("heading", { name: "Workload" }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "By Owner" })).toBeVisible();
  });

  test("workload widget tabs and group expansion update visible state", async ({ page }) => {
    await addWidget(page, /Workload.*Open items/);

    const workload = widgetWithText(page, "Workload");

    await workload.getByRole("tab", { name: "By Series" }).click();
    await expect(workload.getByRole("tab", { name: "By Series" })).toHaveAttribute("aria-selected", "true");

    await workload.getByRole("tab", { name: "Overdue" }).click();
    await expect(workload.getByRole("tab", { name: "Overdue" })).toHaveAttribute("aria-selected", "true");

    const showAll = workload.getByRole("button", { name: /\+\d+ more · Show all/ }).first();
    await expect(showAll).toBeVisible();
    await showAll.click();
    await expect(workload.getByRole("button", { name: "Show less" }).first()).toBeVisible();
  });

  test("reset button restores default widgets", async ({ page }) => {
    await addWidget(page, /Stale Items/);
    await expect(page.getByText("Needs attention")).toBeVisible();

    await openWidgetPicker(page);
    await page.getByRole("button", { name: "Reset" }).click();

    await expect(page.getByText("Needs attention")).not.toBeVisible();
    await expect(page.getByText("Open items across your series")).toBeVisible();
  });

  test("widget state persists across page reload", async ({ page }) => {
    await addWidget(page, /Stale Items/);
    await expect(page.getByText("Needs attention")).toBeVisible();

    await page.reload();
    await waitForApp(page);

    await expect(page.getByText("Needs attention")).toBeVisible();
  });

  test("picker closes on Escape", async ({ page }) => {
    await openWidgetPicker(page);
    const healthLabel = page.getByText("Health", { exact: true });
    await expect(healthLabel).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(healthLabel).not.toBeVisible();
  });

  test("drag handle appears on widget hover", async ({ page }) => {
    const heroWidget = page.locator("[data-testid='widget-hero-1']").first();
    if (await heroWidget.count() === 0) {
      const widget = page.getByText("Open items across your series").locator("../..");
      await widget.hover();
      await expect(page.getByLabel("Drag to reorder").first()).toBeVisible();
    } else {
      await heroWidget.hover();
      await expect(page.getByLabel("Drag to reorder").first()).toBeVisible();
    }
  });

  test("resize toggle appears on widget hover", async ({ page }) => {
    const widget = page.getByText("Open items across your series").locator("../..");
    await widget.hover();
    await expect(page.getByLabel(/Make narrow|Make wide/).first()).toBeVisible();
  });

  test("resize toggle changes widget span", async ({ page }) => {
    const widget = page.getByText("Open items across your series").locator("../..");
    await widget.hover();
    const resizeBtn = page.getByLabel("Make narrow").first();
    await resizeBtn.click();

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("minutia-widgets");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.state?.widgets?.find((w: any) => w.type === "hero")?.span;
    });
    expect(stored).toBe(1);
  });

  test("resize persists across reload", async ({ page }) => {
    const widget = page.getByText("Open items across your series").locator("../..");
    await widget.hover();
    await page.getByLabel("Make narrow").first().click();

    await page.reload();
    await waitForApp(page);

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("minutia-widgets");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.state?.widgets?.find((w: any) => w.type === "hero")?.span;
    });
    expect(stored).toBe(1);
  });

  test("widget reorder persists in localStorage across reload", async ({ page }) => {
    const reordered = [
      { id: "next-meeting-1", type: "next-meeting" },
      { id: "hero-1", type: "hero" },
      { id: "outstanding-1", type: "outstanding" },
      { id: "series-1", type: "series" },
      { id: "decisions-1", type: "decisions" },
      { id: "age-1", type: "age" },
    ];
    await page.evaluate((widgets) => {
      localStorage.setItem(
        "minutia-widgets",
        JSON.stringify({ state: { widgets }, version: 0 })
      );
    }, reordered);

    await page.reload();
    await waitForApp(page);

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("minutia-widgets");
      return raw ? JSON.parse(raw).state?.widgets?.[0]?.type : null;
    });
    expect(stored).toBe("next-meeting");
  });

  test("remove widget button still works with drag handle present", async ({ page }) => {
    await addWidget(page, /Stale Items/);
    await expect(page.getByText("Needs attention")).toBeVisible();

    const stale = widgetWithText(page, "Needs attention");
    await stale.hover();
    await stale.getByLabel("Remove widget").click({ force: true });

    await expect(page.getByText("Needs attention")).not.toBeVisible({ timeout: 10000 });
  });
});
