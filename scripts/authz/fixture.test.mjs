// Unit test for the bounded PostgREST/GoTrue emulator (fixture.mjs) + identity
// scenarios (scenarios.mjs). Proves the fixture's request grammar matches the
// exact reads minutia's real guards issue, so the whole-app authz crawl can
// drive REAL guard code against this seam with no network.
//
// Run: node --test scripts/authz/fixture.test.mjs
//
// Env is set BEFORE importing the fixture/scenarios/identity modules, exactly as
// the harness caller does. Modules are pulled in via dynamic import() so these
// assignments land first (static imports hoist above top-level statements).

import "./env.mjs"; // MUST be first: side-effect module that sets the fixture Supabase env.

import test from "node:test";
import assert from "node:assert/strict";

const SUPA = "http://fixture.supabase.local:54321";

const { mintJwt } = await import("./identity.mjs");
const { makeFixture, UnmatchedRequestError } = await import("./fixture.mjs");
const { baseScenario, makeScenario, uMember, uGlobalAdmin, uCross, orgA, orgB } =
  await import("./scenarios.mjs");

function newFixture() {
  return makeFixture(baseScenario);
}

const OBJECT_ACCEPT = { accept: "application/vnd.pgrst.object+json" };

test("GoTrue: member JWT -> 200 with that user's id; garbage bearer -> 401", async () => {
  const { fetch } = newFixture();

  const ok = await fetch(`${SUPA}/auth/v1/user`, {
    headers: { authorization: `Bearer ${mintJwt(uMember, { email: "member@acme.test" })}` },
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.id, uMember);
  assert.equal(body.email, "member@acme.test");

  const bad = await fetch(`${SUPA}/auth/v1/user`, {
    headers: { authorization: "Bearer garbage.not-a-jwt.x" },
  });
  assert.equal(bad.status, 401);

  const none = await fetch(`${SUPA}/auth/v1/user`);
  assert.equal(none.status, 401);
});

test("profiles.role .single(): global admin -> {role:'admin'}, member -> role null", async () => {
  const { fetch } = newFixture();

  const admin = await fetch(`${SUPA}/rest/v1/profiles?select=role&id=eq.${uGlobalAdmin}`, {
    headers: OBJECT_ACCEPT,
  });
  assert.equal(admin.status, 200);
  const adminBody = await admin.json();
  assert.equal(adminBody.role, "admin");

  const member = await fetch(`${SUPA}/rest/v1/profiles?select=role&id=eq.${uMember}`, {
    headers: OBJECT_ACCEPT,
  });
  assert.equal(member.status, 200);
  const memberBody = await member.json();
  assert.equal(memberBody.role ?? null, null);
});

test("profiles .single() with 0 rows -> 406 PGRST116", async () => {
  const { fetch } = newFixture();
  const res = await fetch(
    `${SUPA}/rest/v1/profiles?select=role&id=eq.99999999-0000-4000-8000-000000000000`,
    { headers: OBJECT_ACCEPT }
  );
  assert.equal(res.status, 406);
  const body = await res.json();
  assert.equal(body.code, "PGRST116");
});

test("organization_members embed: org A -> 4 rows w/ profiles object, none from org B", async () => {
  const { fetch } = newFixture();
  const sel = "user_id,profiles!organization_members_user_id_fkey(id,name,email,avatar_url)";

  const scoped = await fetch(
    `${SUPA}/rest/v1/organization_members?select=${sel}&organization_id=eq.${orgA.id}&order=joined_at`
  );
  assert.equal(scoped.status, 200);
  const rows = await scoped.json();
  assert.equal(rows.length, 4, "org A has 4 members");
  for (const r of rows) {
    assert.ok(r.profiles && typeof r.profiles === "object", "each row has an embedded profiles object");
    assert.ok("id" in r.profiles && "name" in r.profiles && "email" in r.profiles);
  }
  assert.ok(!rows.some((r) => r.user_id === uCross), "no org B member leaks in");

  // Tenant-leak negative control shape: SAME query with the org filter removed
  // returns ALL members including the org B one. checkPolicy relies on this to
  // prove the leak probe would actually surface a cross-tenant row.
  const unscoped = await fetch(`${SUPA}/rest/v1/organization_members?select=${sel}&order=joined_at`);
  const all = await unscoped.json();
  assert.ok(all.length > 4, `expected >4 members unscoped, got ${all.length}`);
  assert.ok(all.some((r) => r.user_id === uCross), "org B member present when unscoped");
});

test("embed projection returns ONLY requested subcols", async () => {
  const { fetch } = newFixture();
  const sel = "user_id,profiles!organization_members_user_id_fkey(id,name,email)";
  const res = await fetch(
    `${SUPA}/rest/v1/organization_members?select=${sel}&organization_id=eq.${orgA.id}`
  );
  const rows = await res.json();
  for (const r of rows) {
    assert.deepEqual(
      Object.keys(r.profiles).sort(),
      ["email", "id", "name"],
      "embed carries only requested subcols"
    );
  }
});

test("organization_invitations scoped to org A -> 2 rows, none from org B", async () => {
  const { fetch } = newFixture();
  const res = await fetch(`${SUPA}/rest/v1/organization_invitations?organization_id=eq.${orgA.id}`);
  const rows = await res.json();
  assert.equal(rows.length, 2);
  const ids = rows.map((r) => r.id).sort();
  assert.deepEqual(ids, ["inv-a1", "inv-a2"]);
  assert.ok(!rows.some((r) => r.organization_id === orgB.id));
});

test("instance_config setup_completed .single() -> {value:'true'}", async () => {
  const { fetch } = newFixture();
  const res = await fetch(`${SUPA}/rest/v1/instance_config?select=value&key=eq.setup_completed`, {
    headers: OBJECT_ACCEPT,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.value, "true");
});

test("count=exact head: org A admins -> content-range total 2", async () => {
  const { fetch } = newFixture();
  const res = await fetch(
    `${SUPA}/rest/v1/organization_members?select=user_id&organization_id=eq.${orgA.id}&role=eq.admin`,
    { headers: { prefer: "count=exact" } }
  );
  assert.equal(res.status, 200);
  const cr = res.headers.get("content-range");
  assert.ok(cr, "content-range header present");
  assert.equal(cr.split("/")[1], "2", `total should be 2, got '${cr}'`);
});

test("storage bucket list -> 200 []", async () => {
  const { fetch } = newFixture();
  const res = await fetch(`${SUPA}/storage/v1/bucket`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test("in.() and is.null filters apply", async () => {
  const { fetch } = newFixture();
  const inRes = await fetch(
    `${SUPA}/rest/v1/organization_members?select=user_id&user_id=in.(${uMember},${uCross})`
  );
  const inRows = await inRes.json();
  assert.equal(inRows.length, 2);

  const nullRes = await fetch(`${SUPA}/rest/v1/profiles?select=id,role&role=is.null`);
  const nullRows = await nullRes.json();
  assert.ok(nullRows.length >= 4, "4 profiles have null role");
  assert.ok(!nullRows.some((r) => r.id === uGlobalAdmin), "admin (role set) excluded");
});

test("a write (POST) throws UnmatchedRequestError and is recorded in unmatched", async () => {
  const fx = newFixture();
  await assert.rejects(
    () => fx.fetch(`${SUPA}/rest/v1/anything`, { method: "POST", body: "{}" }),
    (err) => {
      assert.ok(err instanceof UnmatchedRequestError, "throws UnmatchedRequestError");
      assert.match(err.message, /POST .*\/rest\/v1\/anything/);
      return true;
    }
  );
  assert.ok(
    fx.unmatched.some((u) => u.includes("/rest/v1/anything")),
    "unmatched log records the write"
  );
});

test("rpc call throws UnmatchedRequestError", async () => {
  const fx = newFixture();
  await assert.rejects(
    () => fx.fetch(`${SUPA}/rest/v1/rpc/some_fn`, { method: "POST", body: "{}" }),
    (err) => err instanceof UnmatchedRequestError
  );
});

test("requestLog records every call; reset() clears both logs", async () => {
  const fx = newFixture();
  await fx.fetch(`${SUPA}/storage/v1/bucket`);
  assert.ok(fx.requestLog.some((r) => r === "GET /storage/v1/bucket"));
  try {
    await fx.fetch(`${SUPA}/rest/v1/anything`, { method: "POST" });
  } catch {}
  assert.ok(fx.requestLog.length >= 2);
  assert.ok(fx.unmatched.length >= 1);
  fx.reset();
  assert.equal(fx.requestLog.length, 0);
  assert.equal(fx.unmatched.length, 0);
});

test("makeScenario overrides merge over baseScenario", async () => {
  const s = makeScenario({ env: { NEXT_PUBLIC_FEATURE_GATING: "true" } });
  assert.equal(s.env.NEXT_PUBLIC_FEATURE_GATING, "true");
  assert.equal(baseScenario.env.NEXT_PUBLIC_FEATURE_GATING, "false", "base is untouched");
  assert.ok(s.db.profiles.length === baseScenario.db.profiles.length, "db carried through");
});
