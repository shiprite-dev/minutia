import { test, expect } from "@playwright/test";

test.describe("OIL Board Keyboard Navigation", () => {
  test("J/K moves focus between issues", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    // Press J to focus first issue
    await page.keyboard.press("j");
    const focused = page.locator("[data-focused]");
    await expect(focused).toHaveCount(1);

    // Press J again to move to second
    await page.keyboard.press("j");
    await expect(focused).toHaveCount(1);

    // Press K to move back up
    await page.keyboard.press("k");
    await expect(focused).toHaveCount(1);
  });

  test("Enter on focused issue navigates to detail", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.keyboard.press("j");
    await expect(page.locator("[data-focused]")).toHaveCount(1);

    await page.keyboard.press("Enter");
    await page.waitForURL(/\/issues\//);
    expect(page.url()).toContain("/issues/");
  });

  test("ArrowDown/ArrowUp also work for navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await expect(page.locator("[data-focused]")).toHaveCount(1);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator("[data-focused]")).toHaveCount(1);
  });
});

test.describe("Global key guard", () => {
  test("Enter on a focused status chip expands it and changes status without leaving the board", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();
    await page.keyboard.press("j");
    const row = page.locator("[data-focused]");
    await expect(row).toHaveCount(1);
    const chip = row.getByRole("combobox", { name: /Status:/ });
    const before = (await chip.getAttribute("aria-label"))!;
    const title = (await row.getByRole("link").first().textContent())!.trim();

    try {
      for (let i = 0; i < 80; i++) {
        if (await chip.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(chip).toBeFocused();

      await page.keyboard.press("Enter");
      await expect(chip).toHaveAttribute("aria-expanded", "true");
      expect(page.url()).not.toContain("/issues/");

      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      expect(page.url()).not.toContain("/issues/");
      await expect(chip).not.toHaveAttribute("aria-label", before);

      await page.reload();
      await expect(page.getByText("Outstanding items")).toBeVisible();
      const reloaded = page.locator('[aria-label*=","]').filter({ hasText: title }).first();
      await expect(reloaded.getByRole("combobox", { name: /Status:/ })).not.toHaveAttribute("aria-label", before);
    } finally {
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        await fetch(`${process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/rest/v1/issues?title=eq.${encodeURIComponent(title)}`, {
          method: "PATCH",
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: before.replace("Status: ", "").toLowerCase().replace(" ", "_") }),
        });
      }
    }
  });

  test("Esc closes the due-date popover first and only a second Esc leaves the issue", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/issues\//);
    const issueUrl = page.url();

    await page.getByRole("button", { name: "Due date" }).click();
    const calendar = page.getByRole("grid");
    await expect(calendar).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(calendar).toBeHidden();
    expect(page.url()).toBe(issueUrl);

    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/\/issues\//);
  });

  test("Esc on a deep-linked issue falls back to the board", async ({ page }) => {
    await page.goto("/issues/30000000-0000-0000-0000-000000000001");
    await expect(page.getByText("Lifecycle timeline")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("typing g then s in the board filter stays in the filter", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();
    const filter = page.getByLabel("Filter issues");
    await filter.click();
    await page.keyboard.type("gs");
    await expect(filter).toHaveValue("gs");
    expect(new URL(page.url()).pathname).not.toBe("/series");
  });

  test("j still moves through rows after clicking a filter chip, and g then s still navigates", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Outstanding items")).toBeVisible();

    await page.getByRole("tab", { name: "Overdue" }).click();
    await page.keyboard.press("j");
    await expect(page.locator("[data-focused]")).toHaveCount(1);

    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await expect(page).toHaveURL(/\/series$/);
  });
});
