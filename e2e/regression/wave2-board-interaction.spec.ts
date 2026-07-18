import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { SERIES, waitForApp } from "./seed-data";
import {
  expandOutstandingPreview,
  gotoDashboard,
  groupBySeries,
  HAS_SERVICE_ROLE,
  issueRow,
  outstandingWidget,
} from "./dashboard-helpers";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

type SortOrderRow = { id: string; sort_order: number };

async function fetchOpenIssueSortOrders(request: APIRequestContext, seriesId: string) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/issues?series_id=eq.${seriesId}&status=not.in.(resolved,dropped)&select=id,sort_order`,
    { headers: serviceHeaders() }
  );
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as SortOrderRow[];
}

async function restoreSortOrders(request: APIRequestContext, snapshot: SortOrderRow[]) {
  for (const row of snapshot) {
    const res = await request.patch(`${SUPABASE_URL}/rest/v1/issues?id=eq.${row.id}`, {
      headers: { ...serviceHeaders(), Prefer: "return=minimal" },
      data: { sort_order: row.sort_order },
    });
    expect(res.ok()).toBeTruthy();
  }
}

function seriesSection(page: Page, seriesName: string) {
  return outstandingWidget(page)
    .locator("div.py-5")
    .filter({ has: page.getByRole("link", { name: seriesName, exact: true }) });
}

async function rowTitles(section: Locator): Promise<string[]> {
  const rows = section.locator('[aria-label*=","]');
  const count = await rows.count();
  const titles: string[] = [];
  for (let i = 0; i < count; i++) {
    titles.push((await rows.nth(i).getByRole("link").first().innerText()).trim());
  }
  return titles;
}

test.describe("Wave 2: OIL board drag-to-reorder", () => {
  test.skip(!HAS_SERVICE_ROLE, "SUPABASE_SERVICE_ROLE_KEY is required to snapshot/restore issues.sort_order");

  test("keyboard drag reorders a series group and the new order persists across reload", async ({
    page,
    request,
  }) => {
    const snapshot = await fetchOpenIssueSortOrders(request, SERIES.platformStandup);
    expect(snapshot.length).toBeGreaterThanOrEqual(2);

    try {
      await gotoDashboard(page);
      await groupBySeries(page);
      await expandOutstandingPreview(page);

      const section = seriesSection(page, "Platform Team Standup");
      const titlesBefore = await rowTitles(section);
      expect(titlesBefore.length).toBe(snapshot.length);

      const firstRow = issueRow(page, titlesBefore[0]);
      const secondRow = issueRow(page, titlesBefore[1]);
      await firstRow.hover(); // grip is opacity-0 until row hover
      const grip = firstRow.locator('[aria-roledescription="sortable issue"]');
      await expect(grip).toBeVisible();
      const gripBox = await grip.boundingBox();
      const targetBox = await secondRow.boundingBox();
      if (!gripBox || !targetBox) throw new Error("missing bounding box for drag");

      const reorderResponse = page.waitForResponse(
        (res) =>
          res.url().includes("/rest/v1/rpc/reorder_issues") &&
          res.request().method() === "POST",
        { timeout: 15000 }
      );
      // Mouse drag (dnd-kit PointerSensor). Move past the 4px activation
      // constraint, then step down past the second row so it drops below it.
      await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        gripBox.x + gripBox.width / 2,
        gripBox.y + gripBox.height / 2 + 8,
        { steps: 5 }
      );
      await page.mouse.move(
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height - 2,
        { steps: 12 }
      );
      await page.mouse.up();
      const response = await reorderResponse;
      expect(response.ok()).toBeTruthy();

      const expectedOrder = [titlesBefore[1], titlesBefore[0], ...titlesBefore.slice(2)];
      await expect.poll(() => rowTitles(section)).toEqual(expectedOrder);

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForApp(page);
      await expect(outstandingWidget(page)).toBeVisible();
      await groupBySeries(page);
      await expandOutstandingPreview(page);
      const sectionAfterReload = seriesSection(page, "Platform Team Standup");
      await expect.poll(() => rowTitles(sectionAfterReload)).toEqual(expectedOrder);
    } finally {
      await restoreSortOrders(request, snapshot);
      const restored = await fetchOpenIssueSortOrders(request, SERIES.platformStandup);
      for (const row of snapshot) {
        expect(restored.find((r) => r.id === row.id)?.sort_order).toBe(row.sort_order);
      }
    }
  });
});

test.describe("Wave 2: OIL board owner filter and search", () => {
  test("clicking an owner avatar chip filters to that owner and clears", async ({ page }) => {
    await gotoDashboard(page);

    const targetRow = issueRow(page, "SSL cert expiry risk for api.example.com");
    await expect(targetRow).toBeVisible();
    await targetRow.getByRole("button", { name: "Assignee: Bob" }).click();

    await expect(outstandingWidget(page).getByText(/Owner: Bob/)).toBeVisible();
    await expect(issueRow(page, "SSL cert expiry risk for api.example.com")).toBeVisible();
    await expect(issueRow(page, "Write user research summary for Q2 features")).toHaveCount(0);
    await expect(issueRow(page, "Migrate CI from Jenkins to GitHub Actions")).toHaveCount(0);

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(outstandingWidget(page).getByText(/Owner: Bob/)).not.toBeVisible();
    await expect(issueRow(page, "SSL cert expiry risk for api.example.com")).toBeVisible();
    await expect(issueRow(page, "Write user research summary for Q2 features")).toBeVisible();
  });

  test('"/" focuses the in-board search, staying distinct from the command palette', async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.getByText("Outstanding items").click();

    await page.keyboard.press("/");

    const searchInput = page.getByLabel("Filter issues");
    await expect(searchInput).toBeFocused();
    await expect(page.getByPlaceholder("Search pages, series, issues...")).not.toBeVisible();

    await searchInput.fill("Kubernetes");
    const matchRow = issueRow(page, "Evaluate Kubernetes vs ECS for new services");
    await expect(matchRow.locator("mark")).toHaveText("Kubernetes");
    await expect(issueRow(page, "Migrate CI from Jenkins to GitHub Actions")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(searchInput).toHaveValue("");
    await expect(page.getByRole("button", { name: "Clear filters" })).not.toBeVisible();
    await expect(outstandingWidget(page).locator("mark")).toHaveCount(0);

    await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder("Search pages, series, issues...")).toBeVisible();
  });
});

test.describe("Wave 2: OIL board drag gating", () => {
  test("drag handles are hidden while a filter or search narrows the board", async ({ page }) => {
    await gotoDashboard(page);
    await groupBySeries(page);
    await expandOutstandingPreview(page);

    const grips = outstandingWidget(page).locator('[aria-roledescription="sortable issue"]');
    const baselineCount = await grips.count();
    expect(baselineCount).toBeGreaterThan(0);

    await issueRow(page, "SSL cert expiry risk for api.example.com")
      .getByRole("button", { name: "Assignee: Bob" })
      .click();
    await expect(outstandingWidget(page).getByText(/Owner: Bob/)).toBeVisible();
    await expect(grips).toHaveCount(0);

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expandOutstandingPreview(page);
    await expect(grips).toHaveCount(baselineCount);

    await page.getByText("Outstanding items").click();
    await page.keyboard.press("/");
    await page.getByLabel("Filter issues").fill("Kubernetes");
    await expect(grips).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expandOutstandingPreview(page);
    await expect(grips).toHaveCount(baselineCount);
  });
});
