import { test, expect, type Locator, type Page } from "@playwright/test";
import { waitForApp } from "./seed-data";
import {
  addWidget,
  createDashboardIssue,
  createDashboardIssueUpdate,
  deleteIssue,
  HAS_SERVICE_ROLE,
  openWidgetPicker,
  widgetWithText,
} from "./dashboard-helpers";

type StoredWidget = {
  id: string;
  type: string;
  colSpan?: 1 | 2 | 3 | 4;
  // legacy GridStack fields, still accepted from old persisted state
  span?: 1 | 2;
  layout?: { x?: number; y?: number; w?: number; h?: number };
};

async function setStoredWidgets(page: Page, widgets: StoredWidget[]) {
  await page.evaluate((nextWidgets) => {
    localStorage.setItem(
      "minutia-widgets",
      JSON.stringify({ state: { widgets: nextWidgets }, version: 0 })
    );
  }, widgets);
}

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function centerY(box: { y: number; height: number }) {
  return box.y + box.height / 2;
}

function storedHeroColSpan() {
  const raw = localStorage.getItem("minutia-widgets");
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { state?: { widgets?: StoredWidget[] } };
  return parsed.state?.widgets?.find((w) => w.type === "hero")?.colSpan ?? null;
}

async function expectResponsiveCard(locator: Locator, expectedColSpan: string) {
  await expect(locator).toHaveAttribute("data-col-span", expectedColSpan);

  // Poll: the grid reflows a frame after the col-span attribute flips, so a
  // one-shot read can catch a transient pre-reflow width.
  await expect
    .poll(async () =>
      locator.evaluate((node) => {
        const content = node.querySelector(".widget-card-content");
        if (!content) return true;
        return content.scrollWidth > content.clientWidth + 1;
      })
    )
    .toBe(false);
}

test.describe("Widget system", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("minutia-widgets-cleared")) return;
      localStorage.removeItem("minutia-widgets");
      sessionStorage.setItem("minutia-widgets-cleared", "true");
    });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByRole("button", { name: "Add widget" })).toBeVisible();
  });

  test("dashboard sidebar does not show a fake plan label", async ({ page }) => {
    const sidebar = page.locator("[data-slot='sidebar']").first();

    await expect(sidebar.getByText("Test User").first()).toBeVisible();
    await expect(sidebar.getByText("test@example.com")).toBeVisible();
    await expect(sidebar.getByText("Free plan", { exact: true })).not.toBeVisible();
  });

  test("dashboard renders default widgets on fresh state", async ({ page }) => {
    await expect(page.getByText("Open items across your series")).toBeVisible();
    await expect(page.getByText("Outstanding items")).toBeVisible();
    await expect(page.getByText("Your series").first()).toBeVisible();
    await expect(page.getByText("Recent decisions")).toBeVisible();
    await expect(page.getByText("Age of open items")).toBeVisible();
  });

  test("outstanding widget keeps the original wide card layout on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setStoredWidgets(page, [
      { id: "hero-1", type: "hero" },
      { id: "next-meeting-1", type: "next-meeting" },
      { id: "series-1", type: "series" },
      { id: "outstanding-1", type: "outstanding" },
    ]);
    await page.reload();
    await waitForApp(page);

    const canvas = page.getByTestId("dashboard-widget-canvas");
    await expect(canvas).toHaveAttribute("data-grid-engine", "css-grid");
    await expect(page.getByTestId("widget-outstanding-1")).toHaveAttribute("data-col-span", "4");

    const outstandingBox = await requiredBox(page.getByTestId("widget-outstanding-1"));

    expect(outstandingBox.width).toBeGreaterThan(1000);

    const outstanding = page.getByTestId("widget-outstanding-1");
    await outstanding.hover();
    await expect(outstanding.getByLabel("Make narrow")).not.toBeVisible();
  });

  test("dashboard uses a CSS Grid bento canvas with footprint col-spans", async ({ page }) => {
    const canvas = page.getByTestId("dashboard-widget-canvas");
    await expect(canvas).toHaveAttribute("data-grid-engine", "css-grid");

    await expect(page.getByTestId("widget-hero-1")).toHaveAttribute("data-col-span", "2");
    await expect(page.getByTestId("widget-next-meeting-1")).toHaveAttribute("data-col-span", "1");
    await expect(page.getByTestId("widget-outstanding-1")).toHaveAttribute("data-col-span", "4");
  });

  test("migrates legacy GridStack layouts to default footprints", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      localStorage.setItem(
        "minutia-widgets",
        JSON.stringify({
          state: {
            widgets: [
              { id: "hero-1", type: "hero", layout: { x: 0, y: 0, w: 1, h: 3 } },
              { id: "next-meeting-1", type: "next-meeting", layout: { x: 0, y: 3, w: 1, h: 3 } },
              { id: "outstanding-1", type: "outstanding", layout: { x: 0, y: 6, w: 1, h: 5 } },
            ],
          },
          version: 1,
        })
      );
    });

    await page.reload({ waitUntil: "commit" });
    await waitForApp(page);

    await expect(page.getByTestId("widget-hero-1")).toHaveAttribute("data-col-span", "2");
    await expect(page.getByTestId("widget-next-meeting-1")).toHaveAttribute("data-col-span", "1");
    await expect(page.getByTestId("widget-outstanding-1")).toHaveAttribute("data-col-span", "4");
  });

  test("add widget button opens picker with groups", async ({ page }) => {
    await openWidgetPicker(page);

    await expect(page.getByText("Widgets", { exact: true })).toBeVisible();
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

  test("wide widgets pack around the full-width outstanding card", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setStoredWidgets(page, [
      { id: "hero-1", type: "hero" },
      { id: "meeting-triage-1", type: "meeting-triage" },
      { id: "outstanding-1", type: "outstanding" },
      { id: "workload-1", type: "workload" },
    ]);

    await page.reload();
    await waitForApp(page);

    const heroBox = await page.getByTestId("widget-hero-1").boundingBox();
    const outstandingBox = await page.getByTestId("widget-outstanding-1").boundingBox();
    const triageBox = await page.getByTestId("widget-meeting-triage-1").boundingBox();
    const workloadBox = await page.getByTestId("widget-workload-1").boundingBox();

    expect(heroBox).not.toBeNull();
    expect(outstandingBox).not.toBeNull();
    expect(triageBox).not.toBeNull();
    expect(workloadBox).not.toBeNull();
    expect(outstandingBox?.width ?? 0).toBeGreaterThan(900);
    expect(Math.abs((heroBox?.y ?? 0) - (triageBox?.y ?? 0))).toBeLessThan(2);

    const topRowBottom = Math.max(
      (heroBox?.y ?? 0) + (heroBox?.height ?? 0),
      (triageBox?.y ?? 0) + (triageBox?.height ?? 0)
    );
    expect((outstandingBox?.y ?? 0) - topRowBottom).toBeLessThan(64);
    expect((workloadBox?.y ?? 0) - ((outstandingBox?.y ?? 0) + (outstandingBox?.height ?? 0))).toBeLessThan(96);
  });

  test("meeting triage uses ordinal suffixes for carried meeting counts", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "SUPABASE_SERVICE_ROLE_KEY is required for isolated meeting triage data");

    const created: { id: string }[] = [];

    try {
      created.push(
        await createDashboardIssue(request, `Ordinal first ${Date.now()}`, {
          created_at: "2026-04-21T10:00:00Z",
          updated_at: "2026-04-21T10:00:00Z",
          priority: "critical",
        })
      );
      created.push(
        await createDashboardIssue(request, `Ordinal second ${Date.now()}`, {
          created_at: "2026-04-14T10:00:00Z",
          updated_at: "2026-04-14T10:00:00Z",
          priority: "critical",
        })
      );

      await page.clock.setFixedTime(new Date("2026-04-26T12:00:00Z"));
      await page.reload();
      await waitForApp(page);
      await addWidget(page, /Meeting Triage/);

      const triage = widgetWithText(page, "Meeting triage");
      await expect(triage.getByText("1st meeting")).toBeVisible();
      await expect(triage.getByText("2nd meeting")).toBeVisible();
      await expect(triage.getByText("1th meeting")).not.toBeVisible();
      await expect(triage.getByText("2th meeting")).not.toBeVisible();
    } finally {
      for (const issue of created) {
        await deleteIssue(request, issue.id);
      }
    }
  });

  test("outstanding item metadata lanes stay aligned and assignee avatar reveals details", async ({ page, request }) => {
    test.skip(!HAS_SERVICE_ROLE, "SUPABASE_SERVICE_ROLE_KEY is required for isolated outstanding item data");
    await page.setViewportSize({ width: 1440, height: 1000 });

    const created: { id: string; title: string }[] = [];
    const ownerTitle = `Lane assigned ${Date.now()}`;
    const unassignedTitle = `Lane unassigned ${Date.now()}`;

    try {
      created.push(
        await createDashboardIssue(request, ownerTitle, {
          owner_name: "Jordan Rivera",
          priority: "critical",
          due_date: "2026-06-30",
        })
      );
      created.push(
        await createDashboardIssue(request, unassignedTitle, {
          owner_name: "",
          priority: "critical",
          due_date: "2026-06-30",
        })
      );
      await createDashboardIssueUpdate(request, created[0].id);
      await createDashboardIssueUpdate(request, created[1].id);

      await page.reload();
      await waitForApp(page);

      const assignedRow = widgetWithText(page, "Outstanding items")
        .locator('[aria-label*=","]')
        .filter({ hasText: ownerTitle })
        .first();
      const unassignedRow = widgetWithText(page, "Outstanding items")
        .locator('[aria-label*=","]')
        .filter({ hasText: unassignedTitle })
        .first();

      await expect(assignedRow).toBeVisible();
      await expect(unassignedRow).toBeVisible();
      const laneIds = [
        "issue-status-lane",
        "issue-assignee-lane",
        "issue-update-lane",
        "issue-due-lane",
      ] as const;
      for (const laneId of laneIds) {
        await expect
          .poll(async () => {
            const assignedBox = await assignedRow.getByTestId(laneId).boundingBox();
            const unassignedBox = await unassignedRow.getByTestId(laneId).boundingBox();
            if (!assignedBox || !unassignedBox) return Number.POSITIVE_INFINITY;
            const leftDelta = Math.abs(assignedBox.x - unassignedBox.x);
            const rightDelta = Math.abs(
              assignedBox.x + assignedBox.width - (unassignedBox.x + unassignedBox.width)
            );
            return Math.max(leftDelta, rightDelta);
          })
          .toBeLessThan(2);

        const assignedBox = await requiredBox(assignedRow.getByTestId(laneId));
        const unassignedBox = await requiredBox(unassignedRow.getByTestId(laneId));
        expect(Math.abs(assignedBox.x - unassignedBox.x)).toBeLessThan(3);
        expect(
          Math.abs(
            assignedBox.x + assignedBox.width - (unassignedBox.x + unassignedBox.width)
          )
        ).toBeLessThan(3);
      }

      for (const row of [assignedRow, unassignedRow]) {
        const rowBox = await requiredBox(row);
        for (const laneId of laneIds) {
          const laneBox = await requiredBox(row.getByTestId(laneId));
          expect(Math.abs(centerY(laneBox) - centerY(rowBox))).toBeLessThan(3);
        }
      }
      await expect(assignedRow.getByTestId("issue-due-lane")).toContainText("Due Jun 30");
      await expect(unassignedRow.getByTestId("issue-due-lane")).toContainText("Due Jun 30");
      await expect(assignedRow.getByTestId("issue-update-lane")).toContainText("1 update");
      await expect(unassignedRow.getByTestId("issue-update-lane")).toContainText("1 update");

      const assignee = assignedRow.getByRole("button", { name: "Assignee: Jordan Rivera" });
      await assignee.hover();
      await expect(page.locator("[data-slot='tooltip-content']")).toContainText("Jordan Rivera");
      await assignee.focus();
      await expect(page.locator("[data-slot='tooltip-content']")).toContainText("Jordan Rivera");
    } finally {
      for (const issue of created) {
        await deleteIssue(request, issue.id);
      }
    }
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

    await page.reload({ waitUntil: "domcontentloaded" });
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
    const widget = page.getByTestId("widget-hero-1");
    await widget.hover();
    await expect(page.getByLabel(/Make narrow|Make wide/).first()).toBeVisible();
  });

  test("resize toggle changes widget layout width", async ({ page }) => {
    const widget = page.getByTestId("widget-hero-1");
    await widget.hover();
    const resizeBtn = page.getByLabel("Make narrow").first();
    await resizeBtn.click();

    const stored = await page.evaluate(storedHeroColSpan);
    expect(stored).toBe(1);
  });

  test("resized narrow widgets keep responsive card content", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    const hero = page.getByTestId("widget-hero-1");
    await hero.hover();
    await hero.getByLabel("Make narrow").click();
    await expectResponsiveCard(hero, "1");

    await addWidget(page, /Meeting Triage/);
    const triage = page.locator('[data-widget-type="meeting-triage"]').first();
    await triage.hover();
    await triage.getByLabel("Make narrow").click();
    await expectResponsiveCard(triage, "1");

    await addWidget(page, /Workload.*Open items/);
    const workload = page.locator('[data-widget-type="workload"]').first();
    await workload.hover();
    await workload.getByLabel("Make narrow").click();
    await expectResponsiveCard(workload, "1");

    const pageOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    ));
    expect(pageOverflow).toBe(false);
  });

  test("resize persists across reload", async ({ page }) => {
    const widget = page.getByTestId("widget-hero-1");
    await widget.hover();
    await page.getByLabel("Make narrow").first().click();

    await page.reload();
    await waitForApp(page);

    const stored = await page.evaluate(storedHeroColSpan);
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
    const widgets = [
      { id: "hero-1", type: "hero" },
      { id: "next-meeting-1", type: "next-meeting" },
      { id: "outstanding-1", type: "outstanding" },
      { id: "series-1", type: "series" },
      { id: "decisions-1", type: "decisions" },
      { id: "age-1", type: "age" },
      { id: "stale-items-remove", type: "stale-items" },
    ];
    await page.evaluate((nextWidgets) => {
      localStorage.setItem(
        "minutia-widgets",
        JSON.stringify({ state: { widgets: nextWidgets }, version: 0 })
      );
    }, widgets);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const stale = page.getByTestId("widget-stale-items-remove");
    await expect(stale).toBeVisible();
    await stale.hover();
    await expect(stale.getByLabel("Remove widget")).toBeVisible();
    await stale.getByLabel("Remove widget").click();

    await expect(stale).not.toBeVisible({ timeout: 10000 });

    const removed = await page.evaluate(() => {
      const raw = localStorage.getItem("minutia-widgets");
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { state?: { widgets?: StoredWidget[] } };
      return !parsed.state?.widgets?.some((w) => w.type === "stale-items");
    });
    expect(removed).toBe(true);
  });
});
