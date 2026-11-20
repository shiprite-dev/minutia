import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-web-handoff-"));
const stubDir = path.join(tempDir, "stubs");
fs.mkdirSync(stubDir, { recursive: true });

const S = {};
globalThis.__S = S;

fs.writeFileSync(
  path.join(stubDir, "next-server.mjs"),
  `
export const NextResponse = {
  json(body, init = {}) {
    return { status: init.status ?? 200, headers: new Headers(), async json() { return body; } };
  },
  redirect(url, status = 307) {
    return { status, headers: new Headers({ location: String(url) }) };
  },
};
`,
);
fs.writeFileSync(
  path.join(stubDir, "next-headers.mjs"),
  `
export async function cookies() {
  return { getAll: () => globalThis.__S.cookies.map((name) => ({ name, value: "x" })) };
}
`,
);
fs.writeFileSync(
  path.join(stubDir, "service-role.mjs"),
  `
export function createServiceRoleClient() { return globalThis.__S.admin(); }
`,
);
fs.writeFileSync(
  path.join(stubDir, "supabase-server.mjs"),
  `
export async function createClient() {
  const S = globalThis.__S;
  return {
    auth: {
      async verifyOtp(params) {
        S.verifyCalls.push(params);
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (S.verifyError) return { data: {}, error: S.verifyError };
        S.sessionSet = true;
        return { data: { session: {} }, error: null };
      },
    },
  };
}
`,
);

function stubPlugin() {
  return {
    name: "handoff-stubs",
    setup(instance) {
      const map = {
        "next/server": "next-server.mjs",
        "next/headers": "next-headers.mjs",
        "@/lib/supabase/service-role": "service-role.mjs",
        "@/lib/supabase/server": "supabase-server.mjs",
      };
      for (const [specifier, file] of Object.entries(map)) {
        instance.onResolve(
          { filter: new RegExp(`^${specifier.replace(/[./]/g, "\\$&")}$`) },
          () => ({
            path: path.join(stubDir, file),
          }),
        );
      }
    },
  };
}

async function bundle(entry, name) {
  const outfile = path.join(tempDir, name);
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    absWorkingDir: root,
    plugins: [stubPlugin()],
  });
  return import(pathToFileURL(outfile).href);
}

const { isFreshToken, checkHandoff } = await bundle(
  "src/lib/companion/web-handoff.ts",
  "web-handoff.mjs",
);
const mintRoute = await bundle(
  "src/app/api/companion/web-session/route.ts",
  "mint-route.mjs",
);
const redeemRoute = await bundle(
  "src/app/auth/companion-session/route.ts",
  "redeem-route.mjs",
);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const NONCE =
  "f".repeat(16) + "a1b2c3d4e5f60718293a4b5c6d7e8f90" + "0".repeat(16);
const NONCE_DIGEST = sha256(NONCE);
const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "dana@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
};
const ORIGIN = "http://localhost:3000";

function jwt(iat) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "ES256" })}.${part({ sub: USER.id, iat })}.sig`;
}
const nowSeconds = () => Math.floor(Date.now() / 1000);

function reset(over = {}) {
  Object.assign(S, {
    cookies: [],
    user: USER,
    validJwts: new Set(),
    rows: [],
    nextTokenHash: "hashed-token-1",
    generateCalls: [],
    generateError: null,
    insertError: null,
    verifyCalls: [],
    verifyError: null,
    sessionSet: false,
    admin: () => adminDouble(),
    ...over,
  });
}

function adminDouble() {
  return {
    auth: {
      async getUser(token) {
        if (!S.validJwts.has(token))
          return { data: { user: null }, error: { message: "bad jwt" } };
        return { data: { user: S.user }, error: null };
      },
      admin: {
        async generateLink(params) {
          S.generateCalls.push(params);
          if (S.generateError)
            return {
              data: { properties: null, user: null },
              error: S.generateError,
            };
          return {
            data: {
              properties: {
                hashed_token: S.nextTokenHash,
                action_link:
                  "http://example.com/verify?token=secret-action-link",
                email_otp: "123456",
              },
              user: S.user,
            },
            error: null,
          };
        },
      },
    },
    from(table) {
      assert.equal(table, "companion_web_handoffs");
      const filters = [];
      const query = {
        async insert(row) {
          if (S.insertError) return { data: null, error: S.insertError };
          S.rows.push({
            id: `row-${S.rows.length + 1}`,
            created_at: new Date().toISOString(),
            used_at: null,
            ...row,
          });
          return { data: null, error: null };
        },
        select() {
          return query;
        },
        eq(column, value) {
          filters.push([column, value]);
          return query;
        },
        async maybeSingle() {
          const row = S.rows.find((r) => filters.every(([c, v]) => r[c] === v));
          return { data: row ? { ...row } : null, error: null };
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, "claim_companion_web_handoff");
      const row = S.rows.find((r) => r.id === args.p_id);
      if (!row || row.used_at) return { data: false, error: null };
      row.used_at = new Date().toISOString();
      return { data: true, error: null };
    },
  };
}

function mintRequest({ bearer, body = { nonce_digest: NONCE_DIGEST } } = {}) {
  const headers = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request(`${ORIGIN}/api/companion/web-session`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function freshBearer(iat = nowSeconds()) {
  const token = jwt(iat);
  S.validJwts.add(token);
  return token;
}

function redeemRequest(fields, headers = {}) {
  return new Request(`${ORIGIN}/auth/companion-session`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "sec-fetch-site": "none",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

async function mintOne() {
  const response = await mintRoute.POST(mintRequest({ bearer: freshBearer() }));
  assert.equal(response.status, 200);
  return (await response.json()).token_hash;
}

function captureConsole() {
  const lines = [];
  const originals = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    originals[level] = console[level];
    console[level] = (...args) => lines.push(args.map(String).join(" "));
  }
  return { lines, restore: () => Object.assign(console, originals) };
}

delete process.env.SITE_URL;
delete process.env.NEXT_PUBLIC_SITE_URL;

test("a token issued up to 300 s ago or up to 60 s ahead counts as fresh, nothing past either edge", () => {
  const now = 1_800_000_000;
  assert.equal(isFreshToken(now - 300, now), true);
  assert.equal(isFreshToken(now - 301, now), false);
  assert.equal(isFreshToken(now + 60, now), true);
  assert.equal(isFreshToken(now + 61, now), false);
  assert.equal(isFreshToken(Number.NaN, now), false);
});

test("checkHandoff names each outcome the sign-in page acts on", () => {
  const now = new Date("2026-11-21T12:00:00.000Z");
  const row = {
    token_digest: sha256("tok"),
    nonce_digest: NONCE_DIGEST,
    created_at: "2026-11-21T11:50:00.000Z",
    used_at: null,
  };
  const args = { tokenHash: "tok", nonce: NONCE, now };
  assert.equal(checkHandoff(row, args), "ok");
  assert.equal(checkHandoff(null, args), "missing");
  assert.equal(
    checkHandoff({ ...row, token_digest: sha256("other") }, args),
    "missing",
  );
  assert.equal(
    checkHandoff({ ...row, used_at: "2026-11-21T11:55:00.000Z" }, args),
    "used",
  );
  assert.equal(
    checkHandoff({ ...row, created_at: "2026-11-21T11:49:59.999Z" }, args),
    "expired",
  );
  assert.equal(
    checkHandoff(row, { ...args, nonce: NONCE.slice(0, -1) + "1" }),
    "mismatch",
  );
  assert.equal(checkHandoff(row, { ...args, nonce: "" }), "mismatch");
});

test("theMacWithAFreshTokenGetsOnlyAOneTimeHandoff_andNothingSecretIsStoredOrLogged", async () => {
  reset();
  const log = captureConsole();
  let response;
  try {
    response = await mintRoute.POST(mintRequest({ bearer: freshBearer() }));
  } finally {
    log.restore();
  }
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { token_hash: "hashed-token-1" });
  assert.deepEqual(S.generateCalls, [
    { type: "magiclink", email: "dana@example.com" },
  ]);
  assert.equal(S.rows.length, 1);
  assert.equal(S.rows[0].user_id, USER.id);
  assert.equal(S.rows[0].token_digest, sha256("hashed-token-1"));
  assert.equal(S.rows[0].nonce_digest, NONCE_DIGEST);
  assert.ok(
    !JSON.stringify(S.rows).includes("hashed-token-1"),
    "the raw token is never stored",
  );
  assert.ok(
    !log.lines.some((l) => /hashed-token-1|secret-action-link|123456/.test(l)),
    "nothing secret is logged",
  );
});

test("aBrowserCookieSessionCannotMintAHandoff_evenWithAValidBearer", async () => {
  reset({ cookies: ["sb-127-auth-token"] });
  const response = await mintRoute.POST(mintRequest({ bearer: freshBearer() }));
  assert.equal(response.status, 401);
  assert.equal(S.generateCalls.length, 0);
  assert.equal(S.rows.length, 0);
});

test("aCallerWithNoBearerOrAnInvalidOneIsRefused", async () => {
  reset();
  assert.equal((await mintRoute.POST(mintRequest())).status, 401);
  assert.equal(
    (await mintRoute.POST(mintRequest({ bearer: jwt(nowSeconds()) }))).status,
    401,
  );
  assert.equal(S.generateCalls.length, 0);
});

test("aMacClockAMinuteAheadStillWorks_butAnOldOrFarFutureTokenIsStale", async () => {
  reset();
  for (const offset of [59, -299]) {
    S.nextTokenHash = `hashed-${offset}`;
    const response = await mintRoute.POST(
      mintRequest({ bearer: freshBearer(nowSeconds() + offset) }),
    );
    assert.equal(response.status, 200, `offset ${offset}`);
  }
  for (const offset of [62, -302]) {
    const response = await mintRoute.POST(
      mintRequest({ bearer: freshBearer(nowSeconds() + offset) }),
    );
    assert.equal(response.status, 401, `offset ${offset}`);
    assert.deepEqual(await response.json(), {
      error: "Sign in again to open this meeting.",
      code: "stale_token",
    });
  }
  assert.equal(S.generateCalls.length, 2);
});

test("anUnconfirmedEmailCannotMintAHandoff", async () => {
  reset({ user: { ...USER, email_confirmed_at: null } });
  const response = await mintRoute.POST(mintRequest({ bearer: freshBearer() }));
  assert.equal(response.status, 403);
  assert.equal(S.generateCalls.length, 0);
});

test("aMissingOrMalformedNonceDigestIsRefused", async () => {
  reset();
  for (const body of [
    {},
    { nonce_digest: "abc" },
    { nonce_digest: NONCE_DIGEST.toUpperCase() },
    { nonce_digest: 7 },
  ]) {
    const response = await mintRoute.POST(
      mintRequest({ bearer: freshBearer(), body }),
    );
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(S.generateCalls.length, 0);
});

test("theSixthHandoffInTenMinutesIsRateLimited", async () => {
  reset({ user: { ...USER, id: "22222222-2222-2222-2222-222222222222" } });
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      S.nextTokenHash = `hashed-rate-${i}`;
      statuses.push(
        (await mintRoute.POST(mintRequest({ bearer: freshBearer() }))).status,
      );
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
    assert.equal(S.generateCalls.length, 5);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("aHandoffThatCannotBeStoredIsNeverHandedOut", async () => {
  reset({ insertError: { message: "db down" } });
  const response = await mintRoute.POST(mintRequest({ bearer: freshBearer() }));
  assert.equal(response.status, 500);
  assert.ok(!JSON.stringify(await response.json()).includes("hashed-token-1"));
  reset({ generateError: { message: "gotrue down" } });
  const failed = await mintRoute.POST(mintRequest({ bearer: freshBearer() }));
  assert.equal(failed.status, 500);
  assert.equal(S.rows.length, 0);
});

test("theMacWindowSignsInAndLandsOnTheMeeting", async () => {
  reset();
  const tokenHash = await mintOne();
  const response = await redeemRoute.POST(
    redeemRequest({
      token_hash: tokenHash,
      nonce: NONCE,
      next: "/series/s1/meetings/m1",
    }),
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    `${ORIGIN}/series/s1/meetings/m1`,
  );
  assert.deepEqual(S.verifyCalls, [
    { type: "magiclink", token_hash: tokenHash },
  ]);
  assert.equal(S.sessionSet, true);
  assert.ok(S.rows[0].used_at, "the handoff is spent");
});

test("aUsedHandoffCannotBeReplayed", async () => {
  reset();
  const tokenHash = await mintOne();
  const fields = { token_hash: tokenHash, nonce: NONCE, next: "/dashboard" };
  assert.equal(
    (await redeemRoute.POST(redeemRequest(fields))).headers.get("location"),
    `${ORIGIN}/dashboard`,
  );
  S.sessionSet = false;
  const replay = await redeemRoute.POST(redeemRequest(fields));
  assert.equal(replay.status, 303);
  assert.equal(replay.headers.get("location"), `${ORIGIN}/login`);
  assert.equal(S.verifyCalls.length, 1);
  assert.equal(S.sessionSet, false);
});

test("twoTabsRedeemingTheSameHandoffAtOnceSignInOnlyOnce", async () => {
  reset();
  const tokenHash = await mintOne();
  const fields = { token_hash: tokenHash, nonce: NONCE, next: "/dashboard" };
  const results = await Promise.all([
    redeemRoute.POST(redeemRequest(fields)),
    redeemRoute.POST(redeemRequest(fields)),
  ]);
  const locations = results.map((r) => r.headers.get("location")).sort();
  assert.deepEqual(locations, [`${ORIGIN}/dashboard`, `${ORIGIN}/login`]);
  assert.equal(S.verifyCalls.length, 1);
});

test("aWrongNonceIsRefused_andDoesNotSpendTheHandoff", async () => {
  reset();
  const tokenHash = await mintOne();
  const wrong = await redeemRoute.POST(
    redeemRequest({
      token_hash: tokenHash,
      nonce: NONCE.replace(/f/g, "e"),
      next: "/dashboard",
    }),
  );
  assert.equal(wrong.status, 303);
  assert.equal(wrong.headers.get("location"), `${ORIGIN}/login`);
  assert.equal(S.verifyCalls.length, 0);
  assert.equal(S.rows[0].used_at, null);
  const missingNonce = await redeemRoute.POST(
    redeemRequest({ token_hash: tokenHash, next: "/dashboard" }),
  );
  assert.equal(missingNonce.headers.get("location"), `${ORIGIN}/login`);
  assert.equal(S.verifyCalls.length, 0);
});

test("aHandoffOlderThanTenMinutesIsRefused", async () => {
  reset();
  const tokenHash = await mintOne();
  S.rows[0].created_at = new Date(
    Date.now() - 10 * 60 * 1000 - 1000,
  ).toISOString();
  const response = await redeemRoute.POST(
    redeemRequest({ token_hash: tokenHash, nonce: NONCE, next: "/dashboard" }),
  );
  assert.equal(response.headers.get("location"), `${ORIGIN}/login`);
  assert.equal(S.verifyCalls.length, 0);
});

test("anUnknownTokenIsRefused", async () => {
  reset();
  const response = await redeemRoute.POST(
    redeemRequest({
      token_hash: "never-minted",
      nonce: NONCE,
      next: "/dashboard",
    }),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${ORIGIN}/login`);
  assert.equal(S.verifyCalls.length, 0);
});

test("aTokenTheAuthServerRejectsSignsNobodyIn", async () => {
  reset();
  const tokenHash = await mintOne();
  S.verifyError = { message: "Token has expired or is invalid" };
  const response = await redeemRoute.POST(
    redeemRequest({ token_hash: tokenHash, nonce: NONCE, next: "/dashboard" }),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${ORIGIN}/login`);
  assert.equal(S.sessionSet, false);
});

test("anOffSiteNextPathFallsBackToTheDashboardHome", async () => {
  reset();
  const tokenHash = await mintOne();
  const response = await redeemRoute.POST(
    redeemRequest({
      token_hash: tokenHash,
      nonce: NONCE,
      next: "//evil.example.com/x",
    }),
  );
  assert.equal(response.headers.get("location"), `${ORIGIN}/`);
});

test("anotherSiteCannotPostAHandoffIntoSomeonesBrowser", async () => {
  reset();
  const tokenHash = await mintOne();
  for (const site of ["cross-site", "same-site"]) {
    const response = await redeemRoute.POST(
      redeemRequest(
        { token_hash: tokenHash, nonce: NONCE, next: "/dashboard" },
        { "sec-fetch-site": site },
      ),
    );
    assert.equal(response.headers.get("location"), `${ORIGIN}/login`, site);
  }
  assert.equal(S.verifyCalls.length, 0);
  assert.equal(S.rows[0].used_at, null);
});
