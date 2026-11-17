import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const CALENDAR = "https://www.googleapis.com/auth/calendar.readonly";
const DIRECTORY = "https://www.googleapis.com/auth/directory.readonly";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-google-"));
const S = {};
globalThis.__S = S;

const stubs = {
  "next/server": `
    export const NextResponse = {
      redirect(url) { return { status: 307, location: String(url) }; },
      json(body, init = {}) { return { status: init.status ?? 200, async json() { return body; } }; },
    };
    export class NextRequest {}`,
  "next/headers": `
    export async function cookies() {
      return { get() { return { value: globalThis.__S.stateCookie }; }, set(name, value) { globalThis.__S.stateCookie = value; }, delete() {} };
    }`,
  "@/lib/supabase/server": `
    export async function createClient() {
      const S = globalThis.__S;
      return {
        auth: {
          async exchangeCodeForSession() { return { data: { session: S.session }, error: null }; },
          async getUser() { return { data: { user: { id: "user-1" } } }; },
        },
        from(table) {
          return {
            select() { return this; },
            eq() { return this; },
            async single() {
              return table === "google_oauth_tokens" ? { data: S.tokenRow } : { data: { has_completed_onboarding: true } };
            },
          };
        },
      };
    }`,
  "@/lib/google-calendar": `
    export async function storeTokens(userId, access, refresh, expiresIn, googleEmail, scopes) {
      globalThis.__S.tokenRow = { google_email: googleEmail, scopes };
    }
    export async function getValidAccessToken() { return "access-token"; }`,
  "@/lib/google-workspace-directory": `
    export class GoogleDirectoryPermissionError extends Error {}
    export async function searchWorkspaceDirectory() {
      return [{ resourceName: "people/1", name: "Mina Park", email: "mina@corp.example.com" }];
    }`,
};

function stubPlugin() {
  return {
    name: "google-onboarding-stubs",
    setup(build) {
      for (const [specifier, source] of Object.entries(stubs)) {
        const file = path.join(tempDir, `${specifier.replace(/[^a-z]/gi, "_")}.mjs`);
        fs.writeFileSync(file, source);
        const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
        build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({ path: file }));
      }
    },
  };
}

async function load(rel) {
  const out = path.join(tempDir, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  await esbuild.build({
    entryPoints: [rel],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    plugins: [stubPlugin()],
  });
  return import(pathToFileURL(out).href);
}

const signInCallback = await load("src/app/auth/callback/route.ts");
const connectStart = await load("src/app/api/auth/google/route.ts");
const connectCallback = await load("src/app/api/auth/google/callback/route.ts");
const calendarStatus = await load("src/app/api/calendar/status/route.ts");
const directorySearch = await load("src/app/api/workspace/directory/route.ts");

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "test-key";
process.env.SITE_URL = "https://app.example.com";
process.env.GOOGLE_CLIENT_ID = "client-id";
process.env.GOOGLE_REDIRECT_URI = "https://app.example.com/api/auth/google/callback";

function nextRequest(url) {
  return Object.assign(new Request(url), { nextUrl: new URL(url) });
}

async function signInWithGoogle(grantedScopes) {
  S.session = {
    provider_token: "provider-access-token",
    provider_refresh_token: "provider-refresh-token",
    expires_in: 3600,
    user: { id: "user-1", email: "solo@corp.example.com" },
  };
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://oauth2.googleapis.com/tokeninfo");
    assert.equal(init.headers.Authorization, "Bearer provider-access-token");
    return new Response(JSON.stringify({ scope: grantedScopes.join(" ") }), { status: 200 });
  };
  return signInCallback.GET(new Request("https://app.example.com/auth/callback?code=abc&next=/"));
}

async function connectFromSettings(grantedScopes) {
  const started = await connectStart.GET();
  const state = new URL(started.location).searchParams.get("state");
  globalThis.fetch = async (url) =>
    String(url).includes("/token")
      ? new Response(
          JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: grantedScopes.join(" ") }),
          { status: 200 }
        )
      : new Response(JSON.stringify({ email: "solo@corp.example.com" }), { status: 200 });
  return connectCallback.GET(nextRequest(`https://app.example.com/api/auth/google/callback?code=abc&state=${state}`));
}

async function settingsShows() {
  return (await calendarStatus.GET()).json();
}

async function mentionSearch(query) {
  const res = await directorySearch.GET(nextRequest(`https://app.example.com/api/workspace/directory?q=${query}`));
  return { status: res.status, body: await res.json() };
}

test("a corporate user connecting Google is asked for their calendar, not their organization directory", async () => {
  S.tokenRow = null;
  const res = await connectStart.GET();
  const consent = new URL(res.location);
  assert.equal(consent.origin, "https://accounts.google.com");
  const scopes = consent.searchParams.get("scope").split(" ");
  assert.ok(scopes.includes(CALENDAR));
  assert.ok(!scopes.includes(DIRECTORY));
  assert.equal(consent.searchParams.get("include_granted_scopes"), "true");
});

test("signing in with Google and granting calendar shows the calendar connected", async () => {
  S.tokenRow = null;
  const res = await signInWithGoogle(["openid", "email", CALENDAR]);
  assert.equal(res.location, "https://app.example.com/");
  assert.deepEqual(await settingsShows(), {
    connected: true,
    directoryConnected: false,
    googleEmail: "solo@corp.example.com",
  });
});

test("directory @-mentions keep finding people after the user signs in with Google again", async () => {
  S.tokenRow = { google_email: "solo@corp.example.com", scopes: ["email", CALENDAR, DIRECTORY] };
  assert.equal((await mentionSearch("mi")).body.people.length, 1);

  await signInWithGoogle(["openid", "email", CALENDAR, DIRECTORY]);

  const { status, body } = await mentionSearch("mi");
  assert.equal(status, 200);
  assert.deepEqual(
    body.people.map((person) => person.name),
    ["Mina Park"]
  );
  assert.equal((await settingsShows()).connected, true);
});

test("unticking calendar on the Google consent screen leaves Settings offering to connect it", async () => {
  S.tokenRow = null;
  const res = await signInWithGoogle(["openid", "email"]);
  assert.equal(res.location, "https://app.example.com/");
  assert.equal((await settingsShows()).connected, false);
});

test("an unreadable Google grant never shows the calendar as connected", async () => {
  S.tokenRow = null;
  S.session = { ...S.session, provider_token: "t", provider_refresh_token: "r" };
  globalThis.fetch = async () => new Response("bad", { status: 400 });
  await signInCallback.GET(new Request("https://app.example.com/auth/callback?code=abc&next=/"));
  assert.equal((await settingsShows()).connected, false);
});

test("Settings Connect with calendar unticked returns to Settings still offering to connect", async () => {
  S.tokenRow = null;
  const res = await connectFromSettings(["email"]);
  assert.match(res.location, /^https:\/\/app\.example\.com\/settings\?gcal=error&reason=calendar_not_granted$/);
  assert.equal((await settingsShows()).connected, false);
});

test("Settings Connect with calendar granted shows the calendar connected", async () => {
  S.tokenRow = null;
  const res = await connectFromSettings(["email", CALENDAR]);
  assert.equal(res.location, "https://app.example.com/settings?gcal=connected");
  assert.equal((await settingsShows()).connected, true);
});

test("a user without the directory grant gets no people and no error from @-mention search", async () => {
  S.tokenRow = { google_email: "solo@corp.example.com", scopes: ["email", CALENDAR] };
  assert.deepEqual(await mentionSearch("mi"), { status: 200, body: { people: [] } });
});
test("a hanging Google grant check still signs the user in, with the calendar left to connect", async () => {
  S.tokenRow = null;
  globalThis.fetch = (url, init = {}) =>
    new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal.reason));
    });
  const res = await Promise.race([
    signInCallback.GET(
      new Request("https://app.example.com/auth/callback?code=abc&next=/"),
    ),
    new Promise((resolve) =>
      setTimeout(() => resolve({ location: "still waiting" }), 5000),
    ),
  ]);
  assert.equal(res.location, "https://app.example.com/");
  assert.equal((await settingsShows()).connected, false);
});

test("a network failure on the Google grant check still signs the user in", async () => {
  S.tokenRow = null;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const res = await signInCallback.GET(
    new Request("https://app.example.com/auth/callback?code=abc&next=/"),
  );
  assert.equal(res.location, "https://app.example.com/");
  assert.equal((await settingsShows()).connected, false);
});
