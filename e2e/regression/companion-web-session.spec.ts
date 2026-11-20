import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const MEETING_TITLE = "Handoff check-in";
const SIGNED_OUT = { cookies: [], origins: [] };

type Account = {
  userId: string;
  email: string;
  seriesId: string;
  meetingId: string;
  session: { access_token: string };
};

function serviceHeaders(prefer = "return=representation") {
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
    headers: { ...serviceHeaders(), ...init.headers },
  });
  const text = await response.text();
  expect(response.ok, `${init.method ?? "GET"} ${path} ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

async function passwordGrant(email: string) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    },
  );
  expect(response.ok).toBeTruthy();
  return response.json();
}

async function createAccount(): Promise<Account> {
  const userId = randomUUID();
  const email = `handoff-${userId.slice(0, 8)}@example.com`;
  const [owner] = await rest(
    `profiles?id=eq.${OWNER_ID}&select=current_organization_id`,
  );
  await rest("organization_invitations", {
    method: "POST",
    body: JSON.stringify({
      organization_id: owner.current_organization_id,
      email,
      role: "member",
      status: "pending",
      invited_by: OWNER_ID,
    }),
  });
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders("return=minimal"),
    body: JSON.stringify({
      id: userId,
      email,
      password: "password123",
      email_confirm: true,
      user_metadata: { name: "Dana Reyes", setup_completed: true },
    }),
  });
  expect(created.ok).toBeTruthy();
  await rest(`profiles?id=eq.${userId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: "Dana Reyes",
      has_completed_onboarding: true,
    }),
  });
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  await rest("meeting_series", {
    method: "POST",
    body: JSON.stringify({
      id: seriesId,
      name: "Handoff series",
      description: "",
      cadence: "weekly",
      default_attendees: [],
      owner_id: userId,
      organization_id: owner.current_organization_id,
    }),
  });
  await rest("meetings", {
    method: "POST",
    body: JSON.stringify({
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: MEETING_TITLE,
      date: "2026-11-20",
      attendees: [],
      status: "completed",
      completed_at: new Date().toISOString(),
    }),
  });
  return {
    userId,
    email,
    seriesId,
    meetingId,
    session: await passwordGrant(email),
  };
}

async function deleteAccount(account: Account) {
  await rest(`meeting_series?id=eq.${account.seriesId}`, { method: "DELETE" });
  await rest(`organization_invitations?email=eq.${account.email}`, {
    method: "DELETE",
  });
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${account.userId}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

function newNonce() {
  const nonce = randomBytes(32).toString("hex");
  return { nonce, digest: createHash("sha256").update(nonce).digest("hex") };
}

async function macApi(baseURL: string) {
  return playwrightRequest.newContext({ baseURL, storageState: SIGNED_OUT });
}

async function mint(
  api: APIRequestContext,
  accessToken: string,
  digest: string,
) {
  const response = await api.post("/api/companion/web-session", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { nonce_digest: digest },
  });
  expect(response.status(), (await response.text()).slice(0, 300)).toBe(200);
  const body = await response.json();
  expect(Object.keys(body)).toEqual(["handoff_id"]);
  return body.handoff_id as string;
}

async function signedOutWindow(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    baseURL,
    storageState: SIGNED_OUT,
  });
  return { context, page: await context.newPage() };
}

async function openMacWindow(
  page: Page,
  baseURL: string,
  form: Record<string, string>,
) {
  const url = new URL("/auth/companion-session", baseURL).href;
  await page.route(
    url,
    (route) =>
      route.continue({
        method: "POST",
        headers: {
          ...route.request().headers(),
          "content-type": "application/x-www-form-urlencoded",
        },
        postData: new URLSearchParams(form).toString(),
      }),
    { times: 1 },
  );
  await page.goto(url);
}

async function sessionCookies(context: BrowserContext) {
  return (await context.cookies()).filter((c) =>
    c.name.includes("-auth-token"),
  );
}

async function expectSignedOutOnLogin(page: Page, context: BrowserContext) {
  await expect(page).toHaveURL(
    (url) => url.pathname === "/login" && url.search === "",
  );
  expect(await sessionCookies(context)).toEqual([]);
}

async function expectOnMeeting(page: Page, account: Account) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname ===
      `/series/${account.seriesId}/meetings/${account.meetingId}`,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: MEETING_TITLE, exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("Mac window sign-in handoff", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!SERVICE_KEY, "Requires the service role to create fresh accounts");

  let account: Account | null = null;
  let api: APIRequestContext | null = null;
  const contexts: BrowserContext[] = [];

  test.beforeEach(async ({ baseURL }) => {
    account = await createAccount();
    api = await macApi(baseURL!);
  });

  test.afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    await api?.dispose();
    if (account) await deleteAccount(account);
    account = null;
  });

  test("theMacWindowOpensTheMeetingAlreadySignedIn", async ({
    browser,
    baseURL,
  }) => {
    const { nonce, digest } = newNonce();
    const handoffId = await mint(api!, account!.session.access_token, digest);
    const { context, page } = await signedOutWindow(browser, baseURL!);
    contexts.push(context);

    await openMacWindow(page, baseURL!, {
      handoff_id: handoffId,
      nonce,
      next: `/series/${account!.seriesId}/meetings/${account!.meetingId}`,
    });

    await expectOnMeeting(page, account!);
    await page.reload();
    await expectOnMeeting(page, account!);

    const [row] = await rest(
      `companion_web_handoffs?user_id=eq.${account!.userId}&select=handoff_digest,used_at`,
    );
    expect(row.handoff_digest).toBe(
      createHash("sha256").update(handoffId).digest("hex"),
    );
    expect(row.used_at).not.toBeNull();
  });

  test("aUsedHandoffCannotBeReplayed", async ({ browser, baseURL }) => {
    const { nonce, digest } = newNonce();
    const handoffId = await mint(api!, account!.session.access_token, digest);
    const form = {
      handoff_id: handoffId,
      nonce,
      next: `/series/${account!.seriesId}/meetings/${account!.meetingId}`,
    };

    const first = await signedOutWindow(browser, baseURL!);
    contexts.push(first.context);
    await openMacWindow(first.page, baseURL!, form);
    await expectOnMeeting(first.page, account!);

    const replay = await signedOutWindow(browser, baseURL!);
    contexts.push(replay.context);
    await openMacWindow(replay.page, baseURL!, form);
    await expectSignedOutOnLogin(replay.page, replay.context);
  });

  test("aWrongNonceIsRefused", async ({ browser, baseURL }) => {
    const { nonce, digest } = newNonce();
    const handoffId = await mint(api!, account!.session.access_token, digest);
    const next = `/series/${account!.seriesId}/meetings/${account!.meetingId}`;

    const wrong = await signedOutWindow(browser, baseURL!);
    contexts.push(wrong.context);
    await openMacWindow(wrong.page, baseURL!, {
      handoff_id: handoffId,
      nonce: newNonce().nonce,
      next,
    });
    await expectSignedOutOnLogin(wrong.page, wrong.context);

    const right = await signedOutWindow(browser, baseURL!);
    contexts.push(right.context);
    await openMacWindow(right.page, baseURL!, {
      handoff_id: handoffId,
      nonce,
      next,
    });
    await expectOnMeeting(right.page, account!);
  });

  test("anotherSiteCannotPostAHandoffIntoTheBrowser", async ({
    browser,
    baseURL,
  }) => {
    const { nonce, digest } = newNonce();
    const handoffId = await mint(api!, account!.session.access_token, digest);
    const next = `/series/${account!.seriesId}/meetings/${account!.meetingId}`;
    const victim = await signedOutWindow(browser, baseURL!);
    contexts.push(victim.context);

    await victim.page.setContent(
      `<form method="POST" action="${new URL("/auth/companion-session", baseURL!).href}">
        <input name="handoff_id" value="${handoffId}"><input name="nonce" value="${nonce}">
        <input name="next" value="${next}"><button>Go</button></form>`,
    );
    await victim.page.getByRole("button", { name: "Go" }).click();
    await expectSignedOutOnLogin(victim.page, victim.context);

    const mac = await signedOutWindow(browser, baseURL!);
    contexts.push(mac.context);
    await openMacWindow(mac.page, baseURL!, {
      handoff_id: handoffId,
      nonce,
      next,
    });
    await expectOnMeeting(mac.page, account!);
  });

  test("aBrowserSessionCannotMintAHandoff", async ({ browser, baseURL }) => {
    const { nonce, digest } = newNonce();
    const handoffId = await mint(api!, account!.session.access_token, digest);
    const signedIn = await signedOutWindow(browser, baseURL!);
    contexts.push(signedIn.context);
    await openMacWindow(signedIn.page, baseURL!, {
      handoff_id: handoffId,
      nonce,
      next: `/series/${account!.seriesId}/meetings/${account!.meetingId}`,
    });
    await expectOnMeeting(signedIn.page, account!);

    const cookieOnly = await signedIn.context.request.post(
      "/api/companion/web-session",
      {
        data: { nonce_digest: newNonce().digest },
      },
    );
    expect(cookieOnly.status()).toBe(401);
    const cookieAndBearer = await signedIn.context.request.post(
      "/api/companion/web-session",
      {
        headers: { Authorization: `Bearer ${account!.session.access_token}` },
        data: { nonce_digest: newNonce().digest },
      },
    );
    expect(cookieAndBearer.status()).toBe(401);
    const rows = await rest(
      `companion_web_handoffs?user_id=eq.${account!.userId}&select=id`,
    );
    expect(rows).toHaveLength(1);
  });

  test("aTokenLinkOnTheSharedCallbackSignsNobodyIn", async ({
    browser,
    baseURL,
  }) => {
    const { digest } = newNonce();
    const handoffId = await mint(api!, account!.session.access_token, digest);
    const { context, page } = await signedOutWindow(browser, baseURL!);
    contexts.push(context);

    await page.goto(`/auth/callback?token_hash=${handoffId}&type=magiclink`);

    await expect(page).toHaveURL(
      (url) => url.pathname === "/login" && url.search === "?error=auth",
    );
    expect(await sessionCookies(context)).toEqual([]);
  });

  test("aHandoffIdAloneCannotSignInAtTheSignInServer", async () => {
    const handoffId = await mint(api!, account!.session.access_token, newNonce().digest);

    const verify = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token_hash: handoffId }),
    });

    expect(verify.status).toBe(403);
    expect(await verify.json()).not.toHaveProperty("access_token");
  });

  test("aForeignOriginSubmitWithoutFetchMetadataIsRefused", async ({ baseURL }) => {
    const { nonce, digest } = newNonce();
    const handoffId = await mint(api!, account!.session.access_token, digest);
    const next = `/series/${account!.seriesId}/meetings/${account!.meetingId}`;

    const forged = await api!.post("/auth/companion-session", {
      headers: { Origin: "https://evil.example.com" },
      form: { handoff_id: handoffId, nonce, next },
      maxRedirects: 0,
    });

    expect(forged.status()).toBe(303);
    expect(forged.headers()["location"]).toBe(`${new URL(baseURL!).origin}/login`);
    expect(forged.headers()["set-cookie"] ?? "").not.toContain("-auth-token");
    const [row] = await rest(`companion_web_handoffs?user_id=eq.${account!.userId}&select=used_at`);
    expect(row.used_at).toBeNull();
  });

  test("backToBackHandoffsAllWork_andRedeemingOneEndsOtherOutstandingSignInLinks", async ({
    browser,
    baseURL,
  }) => {
    const next = `/series/${account!.seriesId}/meetings/${account!.meetingId}`;
    const nonces = [newNonce(), newNonce(), newNonce()];
    const handoffs: string[] = [];
    for (const n of nonces) handoffs.push(await mint(api!, account!.session.access_token, n.digest));

    const first = await signedOutWindow(browser, baseURL!);
    contexts.push(first.context);
    await openMacWindow(first.page, baseURL!, { handoff_id: handoffs[0], nonce: nonces[0].nonce, next });
    await expectOnMeeting(first.page, account!);

    const macSignIn = await first.context.request.post("/api/companion/authorize");
    expect(macSignIn.status()).toBe(200);
    const macToken = (await macSignIn.json()).token_hash as string;
    const recovery = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ type: "recovery", email: account!.email }),
    });
    expect(recovery.ok).toBeTruthy();
    const recoveryToken = (await recovery.json()).hashed_token as string;

    const second = await signedOutWindow(browser, baseURL!);
    contexts.push(second.context);
    await openMacWindow(second.page, baseURL!, { handoff_id: handoffs[1], nonce: nonces[1].nonce, next });
    await expectOnMeeting(second.page, account!);

    const verify = async (type: string, token_hash: string) =>
      (
        await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
          method: "POST",
          headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ type, token_hash }),
        })
      ).status;
    expect(await verify("magiclink", macToken)).toBe(403);
    expect(await verify("recovery", recoveryToken)).toBe(403);

    const third = await signedOutWindow(browser, baseURL!);
    contexts.push(third.context);
    await openMacWindow(third.page, baseURL!, { handoff_id: handoffs[2], nonce: nonces[2].nonce, next });
    await expectOnMeeting(third.page, account!);
  });
});
