import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

async function setOnboardingFlag(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  value: boolean
) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  await request.patch(
    `${SUPABASE_URL}/rest/v1/profiles?email=eq.test@example.com`,
    { headers, data: { has_completed_onboarding: value } }
  );
}

test.describe("Onboarding wizard", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ request, page }) => {
    await setOnboardingFlag(request, false);
    await page.goto("/", { waitUntil: "commit" });
    await page.reload({ waitUntil: "networkidle" });
  });

  test.afterEach(async ({ request }) => {
    await setOnboardingFlag(request, true);
  });

  test("shows onboarding wizard for new users", async ({ page }) => {
    await expect(page.getByText("Welcome to Minutia")).toBeVisible();
    await expect(page.getByLabel("What should we call you?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(page.getByText("Skip setup")).toBeVisible();
  });

  test("step 1 pre-fills existing name", async ({ page }) => {
    const nameInput = page.getByLabel("What should we call you?");
    await expect(nameInput).toHaveValue("Test User");
  });

  test("continue button is disabled with empty name", async ({ page }) => {
    const nameInput = page.getByLabel("What should we call you?");
    await nameInput.clear();
    await expect(
      page.getByRole("button", { name: "Continue" })
    ).toBeDisabled();
  });

  test("step 1 advances to step 2 on Continue", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Create your first series")).toBeVisible();
    await expect(page.getByLabel("Meeting name")).toBeVisible();
    await expect(page.getByText("How often?")).toBeVisible();
  });

  test("step 2 has cadence pills and attendees field", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Weekly", { exact: true })).toBeVisible();
    await expect(page.getByText("Biweekly", { exact: true })).toBeVisible();
    await expect(page.getByText("Monthly", { exact: true })).toBeVisible();
    await expect(
      page.getByLabel("Attendees", { exact: false })
    ).toBeVisible();
  });

  test("step 2 create series is disabled without name", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("button", { name: "Create series" })
    ).toBeDisabled();
  });

  test("step 2 skip for now advances to step 3", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByText("You're all set")).toBeVisible();
  });

  test("step 3 shows feature tour items", async ({ page }) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByText("OIL Board")).toBeVisible();
    await expect(page.getByText("Live Capture")).toBeVisible();
    await expect(page.getByText("Pre-Meeting Brief")).toBeVisible();
    await expect(page.getByText("Keyboard First")).toBeVisible();
  });

  test("skip setup goes directly to dashboard", async ({ page }) => {
    await page.getByText("Skip setup").click();
    await page.waitForURL("**/");
    await waitForApp(page);
    await expect(page.getByText("OIL Board")).toBeVisible();
    await expect(page.getByText("Outstanding items")).toBeVisible();
  });

  test("completing onboarding does not show wizard on next visit", async ({
    page,
    request,
  }) => {
    await page.getByText("Skip setup").click();
    await page.waitForURL("**/");
    await waitForApp(page);

    await page.reload();
    await waitForApp(page);
    await expect(page.getByText("Welcome to Minutia")).not.toBeVisible();
    await expect(page.getByText("Outstanding items")).toBeVisible();
  });

  test("full flow: name, create series, complete", async ({ page }) => {
    await expect(page.getByText("Welcome to Minutia")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Meeting name").fill("E2E Onboarding Series");
    await page.getByRole("button", { name: "Create series" }).click();

    await expect(page.getByText("You're all set")).toBeVisible();
    await page.getByRole("button", { name: "Start tracking" }).click();

    await page.waitForURL("**/series/**");
    await waitForApp(page);
    await expect(page.getByText("E2E Onboarding Series")).toBeVisible();
  });
});
