// Identity + database scenarios for the hermetic authz harness. A scenario is
// { identities, db, env }: the fixed set of principals the crawl probes with, the
// table rows the fixture PostgREST serves, and the process env the bundles run
// under. All UUIDs are fixed so policy.json expectations and probe assertions can
// reference concrete ids. Cookies are minted with identity.mjs (unsigned but
// structurally valid @supabase/ssr storage cookies) — no signing, no network.

import { mintCookie } from "./identity.mjs";

// --- Orgs -------------------------------------------------------------------
export const orgAId = "aaaaaaaa-0000-4000-8000-000000000001";
export const orgBId = "bbbbbbbb-0000-4000-8000-000000000002";

// --- Users (profiles ids) ---------------------------------------------------
export const uMember = "10000000-0000-4000-8000-000000000001";
export const uOrgAdmin = "20000000-0000-4000-8000-000000000002";
export const uGlobalAdmin = "30000000-0000-4000-8000-000000000003";
export const uCross = "40000000-0000-4000-8000-000000000004";
export const uPro = "50000000-0000-4000-8000-000000000005";

export const orgA = { id: orgAId, name: "Acme", slug: "acme", created_by: uGlobalAdmin };
export const orgB = { id: orgBId, name: "Globex", slug: "globex", created_by: uGlobalAdmin };

const emails = {
  [uMember]: "member@acme.test",
  [uOrgAdmin]: "orgadmin@acme.test",
  [uGlobalAdmin]: "globaladmin@acme.test",
  [uCross]: "member@globex.test",
  [uPro]: "pro@acme.test",
};

function profile(id, { role = null, current_organization_id, has_full_access, name }) {
  return {
    id,
    role,
    current_organization_id,
    has_full_access,
    email: emails[id],
    name,
    avatar_url: null,
    has_completed_onboarding: true,
  };
}

function buildDb() {
  return {
    organizations: [orgA, orgB],
    profiles: [
      profile(uMember, { current_organization_id: orgAId, has_full_access: false, name: "Member A" }),
      profile(uOrgAdmin, { current_organization_id: orgAId, has_full_access: false, name: "OrgAdmin A" }),
      profile(uGlobalAdmin, {
        role: "admin",
        current_organization_id: orgAId,
        has_full_access: true,
        name: "GlobalAdmin A",
      }),
      profile(uCross, { current_organization_id: orgBId, has_full_access: false, name: "Member B" }),
      profile(uPro, { current_organization_id: orgAId, has_full_access: true, name: "Pro A" }),
    ],
    organization_members: [
      { organization_id: orgAId, user_id: uMember, role: "member", joined_at: "2026-01-01" },
      { organization_id: orgAId, user_id: uOrgAdmin, role: "admin", joined_at: "2026-01-02" },
      { organization_id: orgAId, user_id: uGlobalAdmin, role: "admin", joined_at: "2026-01-03" },
      { organization_id: orgAId, user_id: uPro, role: "member", joined_at: "2026-01-04" },
      { organization_id: orgBId, user_id: uCross, role: "member", joined_at: "2026-01-05" },
    ],
    organization_invitations: [
      { id: "inv-a1", organization_id: orgAId, email: "invitee1@acme.test", role: "member", status: "pending", created_at: "2026-02-01" },
      { id: "inv-a2", organization_id: orgAId, email: "invitee2@acme.test", role: "admin", status: "pending", created_at: "2026-02-02" },
      { id: "inv-b1", organization_id: orgBId, email: "invitee@globex.test", role: "member", status: "pending", created_at: "2026-02-03" },
    ],
    instance_config: [
      { key: "setup_completed", value: "true", encrypted: false },
      { key: "retro_enabled", value: "true", encrypted: false },
      { key: "instance_name", value: "Test Instance", encrypted: false },
      { key: "hosted_mode", value: "false", encrypted: false },
    ],
    google_oauth_tokens: [],
    // Modeled-but-empty: /api/admin/overview count queries read these. Seeding
    // them empty keeps them "declared" so the fixture returns [] instead of
    // throwing (undeclared tables throw — see fixture.mjs).
    meeting_series: [],
    meetings: [],
    issues: [],
  };
}

function buildIdentities() {
  const authed = (key, userId) => ({
    label: key,
    userId,
    cookie: mintCookie(userId, { email: emails[userId] }),
  });
  return {
    loggedOut: { label: "logged-out" },
    member: authed("member", uMember),
    orgAdmin: authed("orgAdmin", uOrgAdmin),
    globalAdmin: authed("globalAdmin", uGlobalAdmin),
    crossTenant: authed("crossTenant", uCross),
    proMember: authed("proMember", uPro),
  };
}

export const baseScenario = {
  identities: buildIdentities(),
  db: buildDb(),
  env: { NEXT_PUBLIC_FEATURE_GATING: "false" },
};

// Shallow-merge overrides over a FRESH base (never mutate baseScenario). db/env/
// identities merge one level deep so callers can flip a single flag or swap one
// table without restating the rest.
export function makeScenario(overrides = {}) {
  const base = { identities: buildIdentities(), db: buildDb(), env: { ...baseScenario.env } };
  return {
    identities: { ...base.identities, ...(overrides.identities ?? {}) },
    db: { ...base.db, ...(overrides.db ?? {}) },
    env: { ...base.env, ...(overrides.env ?? {}) },
  };
}
