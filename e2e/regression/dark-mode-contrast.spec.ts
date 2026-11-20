import { test, expect, type Locator } from "@playwright/test";
import {
  HAS_SERVICE_ROLE,
  createDashboardIssue,
  deleteIssue,
  gotoDashboard,
  issueRow,
} from "./dashboard-helpers";

function localIsoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function renderedContrast(label: Locator) {
  await label.evaluate((el) => el.getAnimations({ subtree: true }).forEach((a) => a.finish()));
  return label.evaluate((el) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgba = (css: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const lum = ([r, g, b]: number[]) => {
      const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    let bg: number[] | null = null;
    for (let n: Element | null = el; n && !bg; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] === 255) bg = c;
    }
    bg ??= rgba(getComputedStyle(document.body).backgroundColor);
    const [hi, lo] = [lum(rgba(getComputedStyle(el).color)), lum(bg)].sort((a, b) => b - a);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  });
}

test.describe("coloured labels stay readable", () => {
  test.skip(!HAS_SERVICE_ROLE, "Requires service role seeding");

  for (const scheme of ["dark", "light"] as const) {
    test(`in ${scheme} mode, an in-progress overdue item on the board can be read`, async ({
      page,
      request,
    }) => {
      const { id, title } = await createDashboardIssue(
        request,
        `Contrast ${scheme} ${Date.now()}`,
        { status: "in_progress", due_date: localIsoDaysAgo(3) },
      );
      try {
        await page.emulateMedia({ colorScheme: scheme });
        await gotoDashboard(page);
        await expect(page.locator("html")).toHaveClass(
          scheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/,
        );

        const row = issueRow(page, title);
        await expect(
          row.getByRole("combobox", { name: "Status: In Progress" }),
        ).toHaveText("In Progress");
        await expect(
          row.getByText("Overdue by 3d", { exact: true }),
        ).toBeVisible();

        for (const label of [
          row.getByRole("combobox", { name: "Status: In Progress" }),
          row.getByText("Overdue by 3d", { exact: true }),
        ]) {
          expect(await renderedContrast(label)).toBeGreaterThanOrEqual(4.5);
        }
      } finally {
        await deleteIssue(request, id);
      }
    });
  }
});
