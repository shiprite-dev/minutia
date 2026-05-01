import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe("Widget system", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("minutia-widgets"));
    await page.reload();
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
    const addBtn = page.getByRole("button", { name: "Add widget" });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    await expect(page.getByText("Widgets")).toBeVisible();
    await expect(page.getByText("Health", { exact: true })).toBeVisible();
    await expect(page.getByText("Meeting", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("People", { exact: true }).first()).toBeVisible();
  });

  test("default widgets show as disabled in picker", async ({ page }) => {
    await page.getByRole("button", { name: "Add widget" }).click();

    const summaryBtn = page.getByRole("button", { name: /Summary.*added/ });
    await expect(summaryBtn).toBeVisible();
    await expect(summaryBtn).toBeDisabled();
  });

  test("can add stale items widget from picker", async ({ page }) => {
    await page.getByRole("button", { name: "Add widget" }).click();

    const staleBtn = page.getByRole("button", { name: /Stale Items/ }).first();
    await expect(staleBtn).toBeEnabled();
    await staleBtn.click();

    await expect(page.getByText("Needs attention")).toBeVisible();
  });

  test("can add meeting triage widget", async ({ page }) => {
    await page.getByRole("button", { name: "Add widget" }).click();
    await page.getByRole("button", { name: /Meeting Triage/ }).click();

    await expect(page.getByRole("heading", { name: "Meeting triage" })).toBeVisible();
    await expect(page.getByText("Carried").first()).toBeVisible();
    await expect(page.getByText("New since last").first()).toBeVisible();
  });

  test("can add workload widget", async ({ page }) => {
    await page.getByRole("button", { name: "Add widget" }).click();
    await page.getByRole("button", { name: /Workload.*Open items/ }).click();

    await expect(page.getByRole("heading", { name: "Workload" }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "By Owner" })).toBeVisible();
  });

  test("reset button restores default widgets", async ({ page }) => {
    await page.getByRole("button", { name: "Add widget" }).click();
    await page.getByRole("button", { name: /Stale Items/ }).first().click();
    await expect(page.getByText("Needs attention")).toBeVisible();

    await page.getByRole("button", { name: "Add widget" }).click();
    await page.getByRole("button", { name: "Reset" }).click();

    await expect(page.getByText("Needs attention")).not.toBeVisible();
    await expect(page.getByText("Open items across your series")).toBeVisible();
  });

  test("widget state persists across page reload", async ({ page }) => {
    await page.getByRole("button", { name: "Add widget" }).click();
    await page.getByRole("button", { name: /Stale Items/ }).first().click();
    await expect(page.getByText("Needs attention")).toBeVisible();

    await page.reload();
    await waitForApp(page);

    await expect(page.getByText("Needs attention")).toBeVisible();
  });

  test("picker closes on Escape", async ({ page }) => {
    await page.getByRole("button", { name: "Add widget" }).click();
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
    await page.getByRole("button", { name: "Add widget" }).click();
    await page.getByRole("button", { name: /Stale Items/ }).first().click();
    await expect(page.getByText("Needs attention")).toBeVisible();

    const staleWidget = page.getByText("Needs attention").locator("../..");
    await staleWidget.hover();
    await page.getByLabel("Remove widget").last().click();

    await expect(page.getByText("Needs attention")).not.toBeVisible();
  });
});
