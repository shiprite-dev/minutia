import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD = "password123";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

type NewUser = { userId: string; email: string; cookieValue: string };

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
    body: JSON.stringify({
      key: "hosted_mode",
      value: enabled ? "true" : "false",
    }),
  });
}

async function workspaceOf(userId: string): Promise<string> {
  const [profile] = await rest(
    `profiles?id=eq.${userId}&select=current_organization_id`,
  );
  return profile.current_organization_id;
}

async function createUser(
  metadata: Record<string, string> | ((emailPrefix: string) => Record<string, string>),
  options: { solo: boolean; inviteTo?: string; role?: "admin" | "member"; emailPrefix?: string },
): Promise<NewUser> {
  const userId = randomUUID();
  const emailPrefix = options.emailPrefix ?? `setup-${userId.slice(0, 8)}`;
  const email = `${emailPrefix}@example.com`;

  if (!options.solo) {
    await rest("organization_invitations", {
      method: "POST",
      body: JSON.stringify({
        organization_id: options.inviteTo ?? (await workspaceOf(TEST_USER_ID)),
        email,
        role: options.role ?? "member",
        status: "pending",
        invited_by: TEST_USER_ID,
      }),
    });
  }

  if (options.solo) await setHostedMode(true);
  try {
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        id: userId,
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: typeof metadata === "function" ? metadata(emailPrefix) : metadata,
      }),
    });
    expect(created.ok).toBeTruthy();
  } finally {
    if (options.solo) await setHostedMode(false);
  }

  const token = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
  );
  expect(token.ok).toBeTruthy();
  const session = await token.json();

  return {
    userId,
    email,
    cookieValue: `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`,
  };
}

async function deleteUser(user: NewUser) {
  const [profile] = await rest(
    `profiles?id=eq.${user.userId}&select=current_organization_id`,
  );
  await rest(`organization_invitations?email=eq.${user.email}`, {
    method: "DELETE",
  });
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

async function grantCalendar(user: NewUser) {
  await rest("google_oauth_tokens", {
    method: "POST",
    body: JSON.stringify({
      user_id: user.userId,
      access_token: "x",
      refresh_token: "x",
      token_iv: "x",
      refresh_iv: "x",
      token_expiry: new Date(Date.now() + 3600_000).toISOString(),
      google_email: user.email,
      scopes: [CALENDAR_SCOPE],
    }),
  });
}

function stubGoogleReturn(page: Page, location: string) {
  return page.route("**/api/auth/google", (route) =>
    route.fulfill({ status: 302, headers: { location } }),
  );
}

async function openSetup(page: Page) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await expect(page.getByTestId("setup-screen")).toBeVisible({
    timeout: 15000,
  });
}

test.describe("First-run setup", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ userAgent: MAC_UA });
  test.skip(!SERVICE_KEY, "Requires the service role to create fresh accounts");

  let user: NewUser | null = null;
  let inviter: NewUser | null = null;

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (user) await deleteUser(user);
    if (inviter) await deleteUser(inviter);
    user = null;
    inviter = null;
  });

  test("a new solo user finishes setup in one screen and lands on the dashboard", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({}, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    const setup = page.getByTestId("setup-screen");
    await expect(
      setup.getByRole("heading", { name: "Welcome to Minutia" }),
    ).toBeVisible();
    await expect(setup.getByText("Google Calendar", { exact: true })).toBeVisible();
    await expect(
      setup.getByRole("link", { name: "Download for Mac" }),
    ).toHaveAttribute("href", "/download");
    await expect(
      setup.getByText(
        "Records your meetings and transcribes them on your Mac.",
      ),
    ).toBeVisible();
    await expect(setup.getByText(/attendee/i)).toHaveCount(0);
    await expect(setup.getByText(/your team/i)).toHaveCount(0);

    await expect(page).toHaveURL(/\/dashboard$/);
    await setup.getByLabel("What should we call you?").fill("Jamie");
    await setup.getByRole("button", { name: "Continue" }).click();

    await page.waitForURL(/\/(dashboard)?$/);
    expect(new URL(page.url()).search).toBe("");
    await waitForApp(page);
    await expect(
      page.getByText("Every good log starts with one meeting."),
    ).toBeVisible();
    await expect(
      page.getByText("We recommend you start the tour first."),
    ).toHaveCount(0);

    await expect(
      page.locator("[data-sidebar='sidebar']").first().getByText("Jamie", { exact: true }),
    ).toBeVisible();

    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByText("Jamie's workspace").first()).toBeVisible({
      timeout: 20000,
    });

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.reload();
    await waitForApp(page);
    await expect(page.getByTestId("setup-screen")).toHaveCount(0);
    await expect(
      page.getByText("We recommend you start the tour first."),
    ).toHaveCount(0);
  });

  test("a new user connects calendar from setup", async ({ page, baseURL }) => {
    user = await createUser({ full_name: "Jamie Rivera" }, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    const setup = page.getByTestId("setup-screen");
    await expect(
      setup.getByRole("heading", { name: "Welcome to Minutia, Jamie Rivera" }),
    ).toBeVisible();
    await expect(setup.getByLabel("What should we call you?")).toHaveCount(0);
    await expect(setup.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
    // Stands in for the Google consent round trip: the grant lands, then the callback returns to the app.
    await grantCalendar(user);
    await stubGoogleReturn(page, "/settings?gcal=connected");
    const connectRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/auth/google",
    );
    await setup.getByRole("link", { name: "Connect Google Calendar" }).click();
    await connectRequest;
    await page.waitForURL(/\/settings\?gcal=connected$/);
    await waitForApp(page);
    await expect(setup.getByText("Google Calendar connected")).toBeVisible();
    await expect(
      setup.getByRole("link", { name: "Connect Google Calendar" }),
    ).toHaveCount(0);

    await setup.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);
    await expect(
      page.locator("[data-sidebar='sidebar']").first().getByText("Jamie Rivera", { exact: true }),
    ).toBeVisible();
  });

  test("the sidebar of a one-person workspace hides the organization block", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ name: "Jamie" }, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);
    await page
      .getByTestId("setup-screen")
      .getByRole("button", { name: "Continue" })
      .click();
    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);

    const sidebar = page.locator("[data-sidebar='sidebar']").first();
    await expect(sidebar.getByText("Jamie", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Organization")).toHaveCount(0);
    await expect(sidebar.getByText("Jamie's workspace")).toHaveCount(0);
  });

  test("an invited teammate sees the organization block after setup", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ name: "Teammate" }, { solo: false });
    await signIn(page, user, baseURL);
    await openSetup(page);
    await page
      .getByTestId("setup-screen")
      .getByRole("button", { name: "Continue" })
      .click();
    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);

    await expect(
      page
        .locator("[data-sidebar='sidebar']")
        .first()
        .getByText("Organization"),
    ).toBeVisible();
  });

  test("a user who cancels Google consent returns to setup with Connect still offered", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ name: "Jamie" }, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);
    await stubGoogleReturn(page, "/settings?gcal=error");

    const setup = page.getByTestId("setup-screen");
    await setup.getByRole("link", { name: "Connect Google Calendar" }).click();
    await page.waitForURL(/\/settings\?gcal=error$/);
    await waitForApp(page);

    await expect(setup.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
    await expect(setup.getByText("Google Calendar connected")).toHaveCount(0);
  });

  test("a user whose calendar is already connected sees it connected with no button", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ name: "Jamie" }, { solo: true });
    await grantCalendar(user);
    await signIn(page, user, baseURL);
    await openSetup(page);

    const setup = page.getByTestId("setup-screen");
    await expect(setup.getByText("Google Calendar connected")).toBeVisible();
    await expect(setup.getByRole("link", { name: "Connect Google Calendar" })).toHaveCount(0);
  });

  test("a very long name is capped", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({}, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    const setup = page.getByTestId("setup-screen");
    const nameField = setup.getByLabel("What should we call you?");
    const continueButton = setup.getByRole("button", { name: "Continue" });
    const longName = "Jamie ".repeat(40);
    const cappedName = longName.slice(0, 100);
    await nameField.fill(longName);
    await expect(nameField).toHaveValue(cappedName);
    await continueButton.click();

    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);
    await expect(
      page.locator("[data-sidebar='sidebar']").first().getByText(cappedName.trim(), { exact: true }),
    ).toBeVisible();
  });

  test("reloading mid-setup shows the same setup screen and saves nothing", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({}, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    await page.getByTestId("setup-screen").getByLabel("What should we call you?").fill("Jamie");
    await page.reload();
    await waitForApp(page);

    const setup = page.getByTestId("setup-screen");
    await expect(setup.getByRole("heading", { name: "Welcome to Minutia" })).toBeVisible();
    await expect(setup.getByLabel("What should we call you?")).toHaveValue("");
    await expect(setup.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  test("a user who finishes setup without typing a name never sees it again after reload", async ({ page, baseURL }) => {
    user = await createUser({}, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    await page.getByTestId("setup-screen").getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);
    await expect(page.getByText("Every good log starts with one meeting.")).toBeVisible();

    await page.reload();
    await waitForApp(page);
    await expect(page.getByText("Every good log starts with one meeting.")).toBeVisible();
    await expect(page.getByTestId("setup-screen")).toHaveCount(0);
  });

  test("a slow then failed save shows progress and an error, and Continue works on retry", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({}, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    let failNext = true;
    await page.route("**/rest/v1/profiles**", async (route) => {
      if (route.request().method() !== "PATCH" || !failNext) return route.continue();
      failNext = false;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "upstream timeout", code: "XX000" }),
      });
    });

    const setup = page.getByTestId("setup-screen");
    await setup.getByLabel("What should we call you?").fill("Jamie");
    await setup.getByRole("button", { name: "Continue" }).click();

    await expect(setup.getByRole("button", { name: "Finishing..." })).toBeDisabled();
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
    const continueButton = setup.getByRole("button", { name: "Continue" });
    await expect(continueButton).toBeEnabled();

    await continueButton.click();
    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);
    await expect(
      page.locator("[data-sidebar='sidebar']").first().getByText("Jamie", { exact: true }),
    ).toBeVisible();
  });

  test("a user finishes setup with the keyboard alone", async ({ page, baseURL }) => {
    user = await createUser({}, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    await expect(page.getByTestId("setup-screen").getByLabel("What should we call you?")).toBeFocused();
    await page.keyboard.type("Jamie");
    await page.keyboard.press("Enter");

    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);
    await expect(
      page.locator("[data-sidebar='sidebar']").first().getByText("Jamie", { exact: true }),
    ).toBeVisible();
  });

  test("an admin invitee finishing setup never renames the inviter's workspace", async ({
    page,
    baseURL,
  }) => {
    const inviteePrefix = `invitee-${randomUUID().slice(0, 8)}`;
    inviter = await createUser({ name: inviteePrefix }, { solo: true });
    const sharedWorkspace = await workspaceOf(inviter.userId);
    user = await createUser({}, {
      solo: false,
      inviteTo: sharedWorkspace,
      role: "admin",
      emailPrefix: inviteePrefix,
    });
    await signIn(page, user, baseURL);
    await openSetup(page);

    await page.getByTestId("setup-screen").getByLabel("What should we call you?").fill("Bob");
    await page.getByTestId("setup-screen").getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);

    const sidebar = page.locator("[data-sidebar='sidebar']").first();
    await expect(sidebar.getByText(`${inviteePrefix}'s workspace`)).toBeVisible();
    await expect(sidebar.getByText("Bob's workspace")).toHaveCount(0);
  });

  test("a failed workspace rename shows an error and Continue succeeds on retry", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({}, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    let failNext = true;
    await page.route("**/rest/v1/organizations**", async (route) => {
      if (route.request().method() !== "PATCH" || !failNext) return route.continue();
      failNext = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "upstream timeout", code: "XX000" }),
      });
    });

    const setup = page.getByTestId("setup-screen");
    await setup.getByLabel("What should we call you?").fill("Jamie");
    await setup.getByRole("button", { name: "Continue" }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
    await expect(setup.getByRole("button", { name: "Continue" })).toBeEnabled();
    await setup.getByRole("button", { name: "Continue" }).click();

    await page.waitForURL(/\/(dashboard)?$/);
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByText("Jamie's workspace").first()).toBeVisible({ timeout: 20000 });
  });

  test("a cancelled Google consent shows a note and keeps the typed name", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({}, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);
    await stubGoogleReturn(page, "/settings?gcal=error");

    const setup = page.getByTestId("setup-screen");
    await setup.getByLabel("What should we call you?").fill("Jamie");
    await setup.getByRole("link", { name: "Connect Google Calendar" }).click();
    await page.waitForURL(/\/settings\?gcal=error$/);
    await waitForApp(page);

    await expect(setup.getByText("Not connected. Try again?", { exact: true })).toBeVisible();
    await expect(setup.getByRole("heading", { name: "Welcome to Minutia, Jamie" })).toBeVisible();
    await expect(setup.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
  });

  test("the tour is not offered on another browser after setup", async ({ page, baseURL }) => {
    user = await createUser({}, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    await page.getByTestId("setup-screen").getByLabel("What should we call you?").fill("Jamie");
    await page.getByTestId("setup-screen").getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);
    await expect(page.getByText("Every good log starts with one meeting.")).toBeVisible();

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await waitForApp(page);
    await expect(page.getByText("Every good log starts with one meeting.")).toBeVisible();
    await expect(page.getByText("We recommend you start the tour first.")).toHaveCount(0);
  });

  test("a user whose chosen name equals their email prefix is not asked again", async ({
    page,
    baseURL,
  }) => {
    user = await createUser((emailPrefix) => ({ name: emailPrefix }), { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    const setup = page.getByTestId("setup-screen");
    const prefix = user.email.split("@")[0];
    await expect(setup.getByRole("heading", { name: `Welcome to Minutia, ${prefix}` })).toBeVisible();
    await expect(setup.getByLabel("What should we call you?")).toHaveCount(0);
  });
});

async function seriesOwnedBy(userId: string) {
  return rest(`meeting_series?owner_id=eq.${userId}&select=name,cadence&order=created_at`);
}

const SAVE_ERROR = "Couldn't save. Check your connection and try again.";
const MEETING_LABEL = "What is your recurring meeting called?";

test.describe("First series from setup", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ userAgent: MAC_UA });
  test.skip(!SERVICE_KEY, "Requires the service role to create fresh accounts");

  let user: NewUser | null = null;

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (user) {
      await rest(`meeting_series?owner_id=eq.${user.userId}`, { method: "DELETE" });
      await deleteUser(user);
    }
    user = null;
  });

  test("aSoloUserNamesTheirRecurringMeetingOnSetup_landsInsideThatSeriesReadyToStartIt", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({}, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    const setup = page.getByTestId("setup-screen");
    await setup.getByLabel("What should we call you?").fill("Jamie");
    await setup.getByLabel(MEETING_LABEL).fill("  Platform weekly  ");
    await setup.getByLabel(MEETING_LABEL).press("Enter");

    await page.waitForURL(/\/series\/[0-9a-f-]{36}$/);
    await waitForApp(page);
    await expect(page.getByRole("heading", { level: 1, name: "Platform weekly", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start meeting" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ask this series" })).toHaveCount(0);
    await expect(page.getByText("AI features are not enabled for this account.")).toHaveCount(0);
    expect(await seriesOwnedBy(user.userId)).toEqual([{ name: "Platform weekly", cadence: "weekly" }]);

    await page.reload();
    await waitForApp(page);
    await expect(page.getByTestId("setup-screen")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Platform weekly", exact: true })).toBeVisible();
    expect(await seriesOwnedBy(user.userId)).toHaveLength(1);
  });

  test("aSoloUserWhoLeavesTheMeetingNameBlankOrSpaces_landsOnTheBoardWithNoSeriesCreated", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ full_name: "Jamie Rivera" }, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    const setup = page.getByTestId("setup-screen");
    await setup.getByLabel(MEETING_LABEL).fill("   ");
    await setup.getByRole("button", { name: "Continue" }).click();

    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);
    await expect(page.getByText("Every good log starts with one meeting.")).toBeVisible();
    expect(await seriesOwnedBy(user.userId)).toEqual([]);
  });

  test("aSoloUserWithGoogleCalendarConnected_isNotAskedForAMeetingName", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ full_name: "Jamie Rivera" }, { solo: true });
    await grantCalendar(user);
    await signIn(page, user, baseURL);
    await page.route("**/api/calendar/status", () => {});
    await openSetup(page);

    const setup = page.getByTestId("setup-screen");
    await expect(setup.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(setup.getByLabel(MEETING_LABEL)).toHaveCount(0);
  });

  test("anInvitedTeammate_isNotAskedForAMeetingName", async ({ page, baseURL }) => {
    user = await createUser({ full_name: "Sam Teammate" }, { solo: false });
    await signIn(page, user, baseURL);
    await openSetup(page);

    await expect(page.getByTestId("setup-screen").getByLabel(MEETING_LABEL)).toHaveCount(0);
  });

  test("aFailedSeriesSave_keepsWhatTheyTyped_andRetryCreatesExactlyOneSeries", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ full_name: "Jamie Rivera" }, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    let failNext = true;
    await page.route("**/rest/v1/meeting_series**", (route) => {
      if (route.request().method() === "POST" && failNext) {
        failNext = false;
        return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      }
      return route.fallback();
    });

    const setup = page.getByTestId("setup-screen");
    await setup.getByLabel(MEETING_LABEL).fill("Design crit");
    await setup.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText(SAVE_ERROR, { exact: true })).toBeVisible();
    await expect(setup).toBeVisible();
    await expect(setup.getByLabel(MEETING_LABEL)).toHaveValue("Design crit");
    await expect(setup.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(await seriesOwnedBy(user.userId)).toEqual([]);

    await setup.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/series\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Design crit", exact: true })).toBeVisible();
    expect(await seriesOwnedBy(user.userId)).toEqual([{ name: "Design crit", cadence: "weekly" }]);
  });

  test("seriesSavedButFinishingSetupFails_retryDoesNotCreateASecondSeries", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ full_name: "Jamie Rivera" }, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    let failNext = true;
    await page.route("**/rest/v1/profiles**", (route) => {
      const finishing = (route.request().postData() ?? "").includes("has_completed_onboarding");
      if (route.request().method() === "PATCH" && finishing && failNext) {
        failNext = false;
        return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      }
      return route.fallback();
    });

    const setup = page.getByTestId("setup-screen");
    await setup.getByLabel(MEETING_LABEL).fill("Design crit");
    await setup.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(SAVE_ERROR, { exact: true })).toBeVisible();
    await expect(setup).toBeVisible();
    expect(await seriesOwnedBy(user.userId)).toEqual([{ name: "Design crit", cadence: "weekly" }]);

    await setup.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/series\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Design crit", exact: true })).toBeVisible();
    expect(await seriesOwnedBy(user.userId)).toEqual([{ name: "Design crit", cadence: "weekly" }]);
  });

  test("aSoloUserArrivingFromADeepLink_isNotAskedAndLandsWhereTheLinkPointed", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ full_name: "Jamie Rivera" }, { solo: true });
    await signIn(page, user, baseURL);
    await page.goto("/dashboard?next=%2Factions", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const setup = page.getByTestId("setup-screen");
    await expect(setup.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(setup.getByLabel(MEETING_LABEL)).toHaveCount(0);
    await setup.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/actions$/);
    expect(await seriesOwnedBy(user.userId)).toEqual([]);
  });

  test("aSaveSlowerThanTheTimeout_thenRetry_stillCreatesExactlyOneSeries", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    user = await createUser({ full_name: "Jamie Rivera" }, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);

    let delayed = false;
    await page.route("**/rest/v1/meeting_series**", async (route) => {
      if (route.request().method() === "POST" && !delayed) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 12_000));
      }
      return route.fallback();
    });

    const setup = page.getByTestId("setup-screen");
    await setup.getByLabel(MEETING_LABEL).fill("Design crit");
    await setup.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(SAVE_ERROR, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(setup.getByLabel(MEETING_LABEL)).toBeDisabled();

    await setup.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/series\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Design crit", exact: true })).toBeVisible();
    expect(await seriesOwnedBy(user.userId)).toEqual([{ name: "Design crit", cadence: "weekly" }]);
  });

  test("fromTheEmptyBoard_theFirstSeriesIsCreatedRightThereAndOpensInsideIt", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ full_name: "Jamie Rivera" }, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);
    await page.getByTestId("setup-screen").getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);

    await page.getByRole("button", { name: "Create your first series" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Create series" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/dashboard");

    await dialog.getByLabel("Name").fill("Weekly 1:1");
    await dialog.getByRole("button", { name: "Create series" }).click();

    await page.waitForURL(/\/series\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Weekly 1:1", exact: true })).toBeVisible();
    expect(await seriesOwnedBy(user.userId)).toEqual([{ name: "Weekly 1:1", cadence: "weekly" }]);
  });

  test("aSoloWorkspaceOwnerSeesNoAdminLink_whileAnAdminInAWorkspaceWithOthersStillDoes", async ({
    page,
    baseURL,
  }) => {
    user = await createUser({ full_name: "Jamie Rivera" }, { solo: true });
    await signIn(page, user, baseURL);
    await openSetup(page);
    await page.getByTestId("setup-screen").getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);
    const sidebar = page.locator("[data-sidebar='sidebar']").first();
    await expect(sidebar.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Admin" })).toHaveCount(0);

    await deleteUser(user);
    user = await createUser({ full_name: "Avery Admin" }, { solo: false, role: "admin" });
    await page.context().clearCookies();
    await signIn(page, user, baseURL);
    await openSetup(page);
    await page.getByTestId("setup-screen").getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/(dashboard)?$/);
    await waitForApp(page);
    await expect(
      page.locator("[data-sidebar='sidebar']").first().getByRole("link", { name: "Admin" }),
    ).toBeVisible();
  });
});
