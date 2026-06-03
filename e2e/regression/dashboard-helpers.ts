import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { MEETINGS, SERIES, waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
export const HAS_SERVICE_ROLE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this test");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export async function gotoDashboard(page: Page) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await expect(page.getByTestId("widget-outstanding-1")).toBeVisible();
}

export function widget(page: Page, id: string) {
  return page.getByTestId(`widget-${id}`);
}

export function widgetWithText(page: Page, text: string | RegExp) {
  return page.locator('[data-testid^="widget-"]').filter({ hasText: text }).first();
}

export function outstandingWidget(page: Page) {
  return widget(page, "outstanding-1");
}

export function issueRow(page: Page, title: string) {
  return outstandingWidget(page)
    .locator('[aria-label*=","]')
    .filter({ hasText: title })
    .first();
}

export async function openWidgetPicker(page: Page) {
  const addButton = page.getByRole("button", { name: "Add widget" });
  await expect(addButton).toBeVisible();
  await addButton.click();
  await expect(page.getByText("Widgets", { exact: true })).toBeVisible();
}

export async function expandOutstandingPreview(page: Page) {
  const more = outstandingWidget(page).getByRole("button", { name: /^\+\d+ more$/ }).first();
  if (!(await more.isVisible().catch(() => false))) return more;
  await more.click();
  return more;
}

export async function selectRowStatus(row: Locator, statusLabel: string) {
  await row.getByRole("combobox", { name: /Status:/ }).click();
  await expect(row.getByRole("listbox", { name: "Select status" })).toBeVisible();
  await row.getByRole("option", { name: statusLabel, exact: true }).click();
  await expect(row.getByRole("combobox", { name: `Status: ${statusLabel}` })).toBeVisible();
}

export async function addWidget(page: Page, name: RegExp | string) {
  await openWidgetPicker(page);
  await page.getByRole("button", { name }).click();
}

export async function createDashboardIssue(
  request: APIRequestContext,
  title = `Dashboard coverage ${Date.now()}`,
  overrides: Record<string, unknown> = {}
) {
  const id = randomUUID();
  const response = await request.post(`${SUPABASE_URL}/rest/v1/issues`, {
    headers: serviceHeaders(),
    data: {
      id,
      series_id: SERIES.platformStandup,
      raised_in_meeting_id: MEETINGS.standup4,
      title,
      description: "Created by dashboard functional coverage.",
      category: "action",
      status: "open",
      priority: "medium",
      owner_name: "Test User",
      due_date: "2026-06-30",
      source: "manual",
      ...overrides,
    },
  });
  expect(response.ok()).toBeTruthy();
  return { id, title };
}

export async function createDashboardIssueUpdate(
  request: APIRequestContext,
  issueId: string,
  note = `Dashboard update ${Date.now()}`
) {
  const response = await request.post(`${SUPABASE_URL}/rest/v1/issue_updates`, {
    headers: serviceHeaders(),
    data: {
      issue_id: issueId,
      meeting_id: MEETINGS.standup4,
      previous_status: "open",
      new_status: "open",
      note,
      author_type: "human",
      updated_by: "00000000-0000-0000-0000-000000000001",
    },
  });
  expect(response.ok()).toBeTruthy();
}

export async function deleteIssue(request: APIRequestContext, id: string) {
  const response = await request.delete(`${SUPABASE_URL}/rest/v1/issues?id=eq.${id}`, {
    headers: serviceHeaders(),
  });
  expect(response.ok()).toBeTruthy();
}
