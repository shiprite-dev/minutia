import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Inviting a colleague from a series: the real invitations route and its real
// authorization run against test-only Supabase and mail doubles that live in
// this harness, never in production code.
const root = process.cwd();
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "minutia-series-invite-"),
);
const stubDir = path.join(tempDir, "stubs");
fs.mkdirSync(stubDir, { recursive: true });

const ORG_A = "a0000000-0000-0000-0000-00000000000a";
const ORG_B = "b0000000-0000-0000-0000-00000000000b";
const ADMIN = "10000000-0000-0000-0000-000000000001";
const OWNER = "10000000-0000-0000-0000-000000000002";
const MEMBER = "10000000-0000-0000-0000-000000000003";
const EXISTING = "10000000-0000-0000-0000-000000000004";
const NEW_USER = "10000000-0000-0000-0000-000000000005";
const SERIES_A = "20000000-0000-0000-0000-00000000000a";
const SERIES_B = "20000000-0000-0000-0000-00000000000b";

const S = {};
globalThis.__S = S;

function reset({ caller = ADMIN, fullAccess = true, gating = false } = {}) {
  Object.assign(S, {
    caller,
    writes: [],
    links: [],
    mail: [],
    tables: {
      profiles: [
        {
          id: ADMIN,
          email: "admin@example.com",
          current_organization_id: ORG_A,
          role: "user",
          has_full_access: fullAccess,
        },
        {
          id: OWNER,
          email: "owner@example.com",
          current_organization_id: ORG_A,
          role: "user",
          has_full_access: fullAccess,
        },
        {
          id: MEMBER,
          email: "member@example.com",
          current_organization_id: ORG_A,
          role: "user",
          has_full_access: fullAccess,
        },
        {
          id: EXISTING,
          email: "existing@example.com",
          current_organization_id: ORG_A,
          role: "user",
          has_full_access: true,
        },
      ],
      organization_members: [
        { organization_id: ORG_A, user_id: ADMIN, role: "admin" },
        { organization_id: ORG_A, user_id: OWNER, role: "member" },
        { organization_id: ORG_A, user_id: MEMBER, role: "member" },
      ],
      meeting_series: [
        { id: SERIES_A, owner_id: OWNER, organization_id: ORG_A },
        { id: SERIES_B, owner_id: ADMIN, organization_id: ORG_B },
      ],
      series_participants: [
        { series_id: SERIES_A, user_id: OWNER, role: "owner" },
        { series_id: SERIES_A, user_id: MEMBER, role: "participant" },
      ],
      organizations: [{ id: ORG_A, name: "Acme" }],
    },
  });
  if (gating) process.env.NEXT_PUBLIC_FEATURE_GATING = "true";
  else delete process.env.NEXT_PUBLIC_FEATURE_GATING;
}

fs.writeFileSync(
  path.join(stubDir, "next-server.mjs"),
  `
export const NextResponse = {
  json(body, init = {}) {
    return { status: init.status ?? 200, async json() { return body; } };
  },
};
export class NextRequest {}
`,
);
fs.writeFileSync(
  path.join(stubDir, "supabase-server.mjs"),
  `
export async function createClient() {
  return { auth: { async getUser() { return { data: { user: globalThis.__S.caller ? { id: globalThis.__S.caller } : null } }; } } };
}
`,
);
fs.writeFileSync(
  path.join(stubDir, "service-role.mjs"),
  `
function read(q) {
  const rows = globalThis.__S.tables[q.table] ?? [];
  const row = rows.find((r) =>
    Object.entries(q.filters).every(([k, v]) => String(r[k]).toLowerCase() === String(v).toLowerCase())
  );
  return { data: row ?? null, error: null };
}
export function createServiceRoleClient() {
  const S = globalThis.__S;
  return {
    from(table) {
      const q = { table, filters: {} };
      const builder = {
        select() { return builder; },
        eq(k, v) { q.filters[k] = v; return builder; },
        ilike(k, v) { q.filters[k] = v; return builder; },
        async single() { return read(q); },
        async maybeSingle() { return read(q); },
        async upsert(row, opts) { S.writes.push({ table, row, opts }); return { error: null }; },
      };
      return builder;
    },
    auth: {
      admin: {
        async generateLink(args) {
          S.links.push(args);
          return {
            data: { user: { id: "${NEW_USER}" }, properties: { action_link: "http://127.0.0.1:54321/auth/v1/verify?token=t" } },
            error: null,
          };
        },
      },
    },
  };
}
`,
);
fs.writeFileSync(
  path.join(stubDir, "email.mjs"),
  `
export function escapeHtml(value) { return String(value); }
export async function sendMail(message) { globalThis.__S.mail.push(message); }
`,
);
fs.writeFileSync(
  path.join(stubDir, "request-origin.mjs"),
  `
export function rejectCrossOrigin() { return null; }
`,
);

const stubs = {
  "@/lib/supabase/server": "supabase-server.mjs",
  "@/lib/supabase/service-role": "service-role.mjs",
  "@/lib/email": "email.mjs",
  "@/lib/request-origin": "request-origin.mjs",
};

const routeBundle = path.join(tempDir, "invitations-route.mjs");
await esbuild.build({
  entryPoints: ["src/app/api/admin/invitations/route.ts"],
  outfile: routeBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  plugins: [
    {
      name: "route-stubs",
      setup(build) {
        for (const [specifier, file] of Object.entries(stubs)) {
          build.onResolve(
            { filter: new RegExp(`^${specifier.replace(/[/.]/g, "\\$&")}$`) },
            () => ({
              path: path.join(stubDir, file),
            }),
          );
        }
        build.onResolve({ filter: /^next\/server$/ }, () => ({
          path: path.join(stubDir, "next-server.mjs"),
        }));
      },
    },
  ],
});
const route = await import(pathToFileURL(routeBundle).href);

const libBundle = path.join(tempDir, "invitations-lib.mjs");
await esbuild.build({
  entryPoints: ["src/lib/invitations.ts"],
  outfile: libBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { parseInviteEmails, seriesInviteEmails } = await import(
  pathToFileURL(libBundle).href
);

async function invite(body) {
  const res = await route.POST({
    url: "http://localhost:3000/api/admin/invitations",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  });
  return { status: res.status, body: await res.json() };
}

const writesTo = (table) => S.writes.filter((w) => w.table === table);

test("a series owner invites a new colleague into the workspace and onto the series", async () => {
  reset({ caller: OWNER });
  const res = await invite({
    email: "New.Person@example.com",
    series_id: SERIES_A,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.invited, true);
  const [invitation] = writesTo("organization_invitations");
  assert.equal(invitation.row.organization_id, ORG_A);
  assert.equal(invitation.row.email, "new.person@example.com");
  assert.equal(invitation.row.role, "member");
  assert.equal(invitation.row.invited_by, OWNER);
  assert.equal(S.links[0].options.data.organization_id, ORG_A);
  const participants = writesTo("series_participants");
  assert.equal(participants.length, 1);
  assert.deepEqual(participants[0].row, {
    series_id: SERIES_A,
    user_id: NEW_USER,
    role: "participant",
    invited_by: OWNER,
  });
  assert.equal(
    participants[0].opts.ignoreDuplicates,
    true,
    "an existing owner or facilitator is never downgraded",
  );
});

test("an existing user invited from a series joins it right away", async () => {
  reset({ caller: OWNER });
  const res = await invite({
    email: "existing@example.com",
    series_id: SERIES_A,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(S.links.length, 0);
  assert.equal(writesTo("series_participants")[0].row.user_id, EXISTING);
});

test("an org admin inviting from a series also adds the invitee to it", async () => {
  reset({ caller: ADMIN });
  S.tables.meeting_series[0].owner_id = OWNER;
  const res = await invite({
    email: "new@example.com",
    role: "admin",
    series_id: SERIES_A,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(writesTo("organization_invitations")[0].row.role, "admin");
  assert.equal(writesTo("series_participants")[0].row.series_id, SERIES_A);
});

test("a series owner who is not an org admin cannot grant the admin role", async () => {
  reset({ caller: OWNER });
  const res = await invite({
    email: "new@example.com",
    role: "admin",
    series_id: SERIES_A,
  });
  assert.equal(res.status, 403);
  assert.equal(S.writes.length, 0);
});

test("a participant who does not run the series cannot invite", async () => {
  reset({ caller: MEMBER });
  const res = await invite({ email: "new@example.com", series_id: SERIES_A });
  assert.equal(res.status, 403);
  assert.equal(S.writes.length, 0);
  assert.equal(S.mail.length, 0);
});

test("a series from another workspace cannot be used to add people", async () => {
  reset({ caller: ADMIN });
  const res = await invite({ email: "new@example.com", series_id: SERIES_B });
  assert.equal(res.status, 404);
  assert.equal(S.writes.length, 0);
});

test("a non-admin without a series still cannot invite", async () => {
  reset({ caller: OWNER });
  const res = await invite({ email: "new@example.com" });
  assert.equal(res.status, 403);
  assert.equal(S.writes.length, 0);
});

test("an org admin invite without a series is unchanged", async () => {
  reset({ caller: ADMIN });
  const res = await invite({ email: "new@example.com" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(writesTo("organization_invitations").length, 1);
  assert.equal(writesTo("series_participants").length, 0);
});

test("with gating on, an inviter without full access gets a machine-readable upgrade code", async () => {
  reset({ caller: OWNER, fullAccess: false, gating: true });
  try {
    const res = await invite({ email: "new@example.com", series_id: SERIES_A });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "INVITE_UPGRADE_REQUIRED");
    assert.equal(typeof res.body.error, "string");
    assert.equal(S.writes.length, 0);
  } finally {
    delete process.env.NEXT_PUBLIC_FEATURE_GATING;
  }
});

test("parseInviteEmails splits on commas and whitespace, lowercases, and drops duplicates", () => {
  assert.deepEqual(parseInviteEmails(" A@x.com, b@x.com\nc@x.com a@X.com ,,"), [
    "a@x.com",
    "b@x.com",
    "c@x.com",
  ]);
  assert.deepEqual(parseInviteEmails(""), []);
});

test("seriesInviteEmails prefills only attendee entries that are email addresses", () => {
  assert.equal(
    seriesInviteEmails([
      "Alice",
      "bob@example.com",
      "Carol <c>",
      "Dan@Example.com",
      "bob@example.com",
    ]),
    "bob@example.com, dan@example.com",
  );
  assert.equal(seriesInviteEmails([]), "");
  assert.equal(seriesInviteEmails(undefined), "");
});
