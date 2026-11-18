import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = "password123";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

type NewUser = { userId: string; email: string; prefix: string; cookieValue: string };

function serviceHeaders(prefer = "return=minimal") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders("return=representation"), ...init.headers },
  });
  expect(response.ok, `${init.method ?? "GET"} ${path}`).toBeTruthy();
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function setHostedMode(enabled: boolean) {
  await rest("instance_config?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key: "hosted_mode", value: enabled ? "true" : "false" }),
  });
}

async function createSoloUser(): Promise<NewUser> {
  const userId = randomUUID();
  const prefix = `polish-${userId.slice(0, 8)}`;
  const email = `${prefix}@example.com`;
  await setHostedMode(true);
  try {
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        id: userId,
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: {},
      }),
    });
    expect(created.ok).toBeTruthy();
  } finally {
    await setHostedMode(false);
  }
  const token = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(token.ok).toBeTruthy();
  const session = await token.json();
  return {
    userId,
    email,
    prefix,
    cookieValue: `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`,
  };
}

async function deleteUser(user: NewUser) {
  const [profile] = await rest(
    `profiles?id=eq.${user.userId}&select=current_organization_id`,
  );
  if (profile?.current_organization_id) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/organizations?id=eq.${profile.current_organization_id}&created_by=eq.${user.userId}`,
      { method: "DELETE", headers: serviceHeaders() },
    );
  }
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.userId}`, {
    method: "DELETE",
    headers: serviceHeaders(),
  });
}

async function signIn(page: Page, user: NewUser, baseURL: string | undefined) {
  await page.context().addCookies([
    {
      name: "sb-127-auth-token",
      value: user.cookieValue,
      url: new URL(baseURL ?? "http://localhost:3000").origin,
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
      sameSite: "Lax",
    },
  ]);
}

async function openSetup(page: Page, path = "/dashboard") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await expect(page.getByTestId("setup-screen")).toBeVisible({ timeout: 15000 });
}

async function expectDashboard(page: Page) {
  await page.waitForURL(/\/(dashboard)?$/);
  await waitForApp(page);
  await expect(page.getByText("Every good log starts with one meeting.")).toBeVisible();
}

function sidebarName(page: Page, name: string) {
  return page.locator("[data-sidebar='sidebar']").first().getByText(name, { exact: true });
}

test.describe("Setup screen polish", () => {
  test.skip(!SERVICE_KEY, "Requires the service role to create fresh accounts");
  test.use({ userAgent: MAC_UA });

  let user: NewUser;

  test.beforeEach(async ({ page, baseURL }) => {
    user = await createSoloUser();
    await signIn(page, user, baseURL);
  });

  test.afterEach(async () => {
    await deleteUser(user);
  });

  test("offlineContinue_showsTheSaveErrorWithinTenSecondsAndRetryLandsOnTheDashboard", async ({
    page,
    context,
  }) => {
    await openSetup(page);
    const setup = page.getByTestId("setup-screen");
    await setup.getByLabel("What should we call you?").fill("Jamie");
    await context.setOffline(true);
    await setup.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByText("Couldn't save. Check your connection and try again.", { exact: true }),
    ).toBeVisible({ timeout: 12000 });
    await expect(setup.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await expect(setup.getByRole("button", { name: "Finishing...", exact: true })).toHaveCount(0);

    await context.setOffline(false);
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await expectDashboard(page);
    await expect(sidebarName(page, "Jamie")).toBeVisible();
  });

  test("emptyNameThenContinue_landsOnTheDashboardGreetedByTheEmailPrefixAndSurvivesReload", async ({
    page,
  }) => {
    await openSetup(page);
    const setup = page.getByTestId("setup-screen");
    await expect(setup.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await expect(setup.getByRole("button", { name: "Skip", exact: true })).toHaveCount(0);
    await setup.getByRole("button", { name: "Continue", exact: true }).click();

    await expectDashboard(page);
    await expect(sidebarName(page, user.prefix)).toBeVisible();
    await page.reload();
    await expectDashboard(page);
    await expect(page.getByTestId("setup-screen")).toHaveCount(0);
    await expect(sidebarName(page, user.prefix)).toBeVisible();
  });

  test("pressingEnterInTheNameField_finishesSetupWithThatName", async ({ page }) => {
    await openSetup(page);
    const setup = page.getByTestId("setup-screen");
    await setup.getByLabel("What should we call you?").fill("Jamie");
    await page.keyboard.press("Enter");

    await expectDashboard(page);
    await expect(sidebarName(page, "Jamie")).toBeVisible();
  });

  test("loadingTheScreen_causesNoLayoutShiftAndTheRowsStayPut", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number; __shifts: string[] };
      w.__cls = 0;
      w.__shifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
            sources: { node?: Element }[];
          };
          if (shift.hadRecentInput) continue;
          w.__cls += shift.value;
          w.__shifts.push(
            shift.sources.map((source) => source.node?.nodeName + "[" + (source.node?.textContent ?? "").slice(0, 40) + "]").join(",") + ":" + shift.value,
          );
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const statusSettled = page.waitForResponse("**/api/calendar/status");
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const setup = page.getByTestId("setup-screen");
    await expect(setup).toBeVisible({ timeout: 15000 });
    const rows = setup.locator("ul > li");
    const rowsAtFirstPaint = await rows.count();
    const subtitleAtFirstPaint = await setup.locator("h1 + p").innerText();
    await statusSettled;
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);

    expect(await rows.count()).toBe(rowsAtFirstPaint);
    expect(await setup.locator("h1 + p").innerText()).toBe(subtitleAtFirstPaint);
    const shifts = await page.evaluate(() => (window as unknown as { __shifts: string[] }).__shifts);
    expect(shifts).toEqual([]);
    expect(
      await page.evaluate(() => (window as unknown as { __cls: number }).__cls),
    ).toBe(0);
  });

  test("setupScreen_hasExactlyOneFilledPrimaryButton", async ({ page }) => {
    await openSetup(page);
    const setup = page.getByTestId("setup-screen");
    await expect(setup.getByRole("link", { name: "Download for Mac", exact: true })).toBeVisible();
    const filled = await setup.evaluate((root) => {
      const controls = [...root.querySelectorAll<HTMLElement>("button, a")];
      const primary = getComputedStyle(
        root.querySelector<HTMLElement>("button[type='submit']")!,
      ).backgroundColor;
      return controls
        .filter((el) => getComputedStyle(el).backgroundColor === primary)
        .map((el) => el.textContent?.trim());
    });
    expect(filled).toEqual(["Continue"]);
  });

  test("onAPhone_setupDoesNotOfferTheMacDownload", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await signIn(page, user, baseURL);
    await openSetup(page);
    const setup = page.getByTestId("setup-screen");
    await expect(setup.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    await expect(setup.getByText("Get the Mac app", { exact: true })).toHaveCount(0);
    await expect(setup.getByRole("link", { name: "Download for Mac", exact: true })).toHaveCount(0);
    await context.close();
  });

  test("afterCancellingGoogleConsent_theNoteIsAnnouncedAsAProblemWithExactCopy", async ({ page }) => {
    await openSetup(page, "/dashboard?gcal=error");
    const note = page.getByTestId("setup-screen").getByRole("status");
    await expect(note).toHaveText("Not connected. Try again?");
    await expect(note.locator("svg")).toHaveCount(1);
    const colors = await note.evaluate((el) => ({
      note: getComputedStyle(el).color,
      helper: getComputedStyle(el.parentElement!.querySelector("p")!).color,
    }));
    expect(colors.note).not.toBe(colors.helper);
  });

  test("onA375pxPhone_rowButtonsAlignWithTheRowText", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSetup(page);
    const setup = page.getByTestId("setup-screen");
    const rows = [
      ["Google Calendar", "Connect Google Calendar"],
      ["Get the Mac app", "Download for Mac"],
    ];
    for (const [title, action] of rows) {
      const text = await setup.getByText(title, { exact: true }).boundingBox();
      const button = await setup.getByRole("link", { name: action, exact: true }).boundingBox();
      expect(text, title).not.toBeNull();
      expect(button, action).not.toBeNull();
      expect(Math.abs(button!.x - text!.x), `${action} left edge vs text`).toBeLessThan(0.5);
    }
  });

  for (const height of [700, 801]) {
    test(`setupForm_topEdgeLandsOnAWholePixelAt${height}pxTall`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height });
      await openSetup(page);
      const box = await page.getByTestId("setup-screen").locator("form").boundingBox();
      expect(box!.y % 1).toBe(0);
    });
  }

  test("newUserOpeningTheMacPairingLink_finishesSetupAndLandsBackOnPairingThatCompletes", async ({
    page,
    baseURL,
  }) => {
    await page.context().clearCookies();
    const link = "/companion/authorize?device=Test%20Mac&state=abc123";
    await page.goto(link, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login\?.*next=/);
    await signIn(page, user, baseURL);
    await page.goto(page.url(), { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByTestId("setup-screen")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("setup-screen").getByLabel("What should we call you?").fill("Jamie");
    await page.getByTestId("setup-screen").getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByText("Authorize the Minutia Mac app on Test Mac?", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const landed = new URL(page.url());
    expect(landed.pathname).toBe("/companion/authorize");
    expect(landed.searchParams.get("device")).toBe("Test Mac");
    expect(landed.searchParams.get("state")).toBe("abc123");

    await page.route("**/api/companion/authorize", (route) =>
      route.fulfill({ json: { token_hash: "hash-for-test" } }),
    );
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Approved. Opening the Minutia app.");
    await expect(page.getByRole("link", { name: "Open the Minutia app", exact: true })).toHaveAttribute(
      "href",
      /state=abc123/,
    );
  });

  test("newUserGraduatingARetro_landsOnTheNewSeriesAfterSetup", async ({ page }) => {
    const destination = `/series/${randomUUID()}`;
    await openSetup(page, destination);
    await page.getByTestId("setup-screen").getByLabel("What should we call you?").fill("Jamie");
    await page.getByTestId("setup-screen").getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByTestId("setup-screen")).toHaveCount(0, { timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe(destination);
  });

  test("inviteNextPath_isPreservedThroughSetup", async ({ page }) => {
    const next = `/series/${randomUUID()}?tab=issues`;
    await openSetup(page, `/dashboard?next=${encodeURIComponent(next)}`);
    await page.getByTestId("setup-screen").getByLabel("What should we call you?").fill("Jamie");
    await page.getByTestId("setup-screen").getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByTestId("setup-screen")).toHaveCount(0, { timeout: 15000 });
    const landed = new URL(page.url());
    expect(landed.pathname + landed.search).toBe(next);
  });

  for (const [kind, evil] of [["absoluteUrl", "https://evil.example"], ["protocolRelative", "//evil.example"], ["backslash", "/\\evil.example"], ["dotSegments", "/.//evil.com"], ["backslashHost", "/\\evil.com"]]) {
    test(`unsafeNext_${kind}_landsOnTheDashboard`, async ({ page, baseURL }) => {
      await openSetup(page, `/dashboard?next=${encodeURIComponent(evil)}`);
      await page.getByTestId("setup-screen").getByLabel("What should we call you?").fill("Jamie");
    await page.getByTestId("setup-screen").getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByTestId("setup-screen")).toHaveCount(0, { timeout: 15000 });
      await waitForApp(page);
      const landed = new URL(page.url());
      expect(landed.origin).toBe(new URL(baseURL ?? "http://localhost:3000").origin);
      expect(landed.pathname).toBe("/dashboard");
      expect(landed.search).toBe("");
    });
  }
});
