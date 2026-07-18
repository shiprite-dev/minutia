// Node manifest — maps each policy node id to a concrete probe target (a screen
// URL to run through middleware, the admin server-layout guard, or a route-handler
// module + url). The set of manifest ids MUST equal the set of policy node ids:
// a policy node with no probe target (or a target with no policy node) is a bug,
// so we assert exact equality at import and fail loud on drift.

import policy from "./policy.json" with { type: "json" };

export const manifest = [
  // --- Screens (probed through the REAL middleware) ------------------------
  { id: "screen:/", kind: "screen", url: "/" },
  { id: "screen:/login", kind: "screen", url: "/login" },
  { id: "screen:/signup", kind: "screen", url: "/signup" },
  { id: "screen:/reset-password", kind: "screen", url: "/reset-password" },
  { id: "screen:/accept-invite", kind: "screen", url: "/accept-invite" },
  { id: "screen:/setup", kind: "screen", url: "/setup" },
  { id: "screen:/retro", kind: "screen", url: "/retro" },
  { id: "screen:/retro/:token", kind: "screen", url: "/retro/tok123" },
  { id: "screen:/share/:token", kind: "screen", url: "/share/tok123" },
  { id: "screen:/~offline", kind: "screen", url: "/~offline" },
  { id: "screen:/dashboard", kind: "screen", url: "/dashboard" },
  { id: "screen:/inbox", kind: "screen", url: "/inbox" },
  { id: "screen:/actions", kind: "screen", url: "/actions" },
  { id: "screen:/settings", kind: "screen", url: "/settings" },
  { id: "screen:/series", kind: "screen", url: "/series" },
  { id: "screen:/series/:id", kind: "screen", url: "/series/seed-series" },
  {
    id: "screen:/series/:id/meetings/:meetingId",
    kind: "screen",
    url: "/series/seed-series/meetings/seed-meeting",
  },
  { id: "screen:/issues/:id", kind: "screen", url: "/issues/seed-issue" },
  { id: "screen:/companion/authorize", kind: "screen", url: "/companion/authorize" },
  { id: "screen:/invite-requests/review", kind: "screen", url: "/invite-requests/review" },

  // --- Guards (server-component role gates) --------------------------------
  { id: "guard:admin-layout", kind: "guard", module: "src/app/(app)/admin/layout.tsx" },
  { id: "guard:admin-instance", kind: "guard", module: "src/app/(app)/admin/(instance)/layout.tsx" },

  // --- Endpoints (route handlers; probed middleware-first, then handler) ----
  {
    id: "endpoint:GET /api/admin/config",
    kind: "endpoint",
    method: "GET",
    module: "src/app/api/admin/config/route.ts",
    url: "http://localhost:3000/api/admin/config",
  },
  {
    id: "endpoint:GET /api/admin/overview",
    kind: "endpoint",
    method: "GET",
    module: "src/app/api/admin/overview/route.ts",
    url: "http://localhost:3000/api/admin/overview",
  },
  {
    id: "endpoint:GET /api/admin/invitations",
    kind: "endpoint",
    method: "GET",
    module: "src/app/api/admin/invitations/route.ts",
    url: "http://localhost:3000/api/admin/invitations",
  },
  {
    id: "endpoint:GET /api/workspace/members",
    kind: "endpoint",
    method: "GET",
    module: "src/app/api/workspace/members/route.ts",
    url: "http://localhost:3000/api/workspace/members",
  },
  {
    id: "endpoint:GET /api/setup/status",
    kind: "endpoint",
    method: "GET",
    module: "src/app/api/setup/status/route.ts",
    url: "http://localhost:3000/api/setup/status",
  },
  {
    id: "endpoint:GET /api/instance-meta",
    kind: "endpoint",
    method: "GET",
    module: "src/app/api/instance-meta/route.ts",
    url: "http://localhost:3000/api/instance-meta",
  },
];

// Deferred routes — on-disk page/API routes NOT executed in the matrix above,
// each with a short reason. coverage.test.mjs asserts every page.tsx / route.ts
// on disk is EITHER executed (in `manifest`) OR listed here — nothing escapes
// classification — and that every key here still exists on disk (no rot).
export const deferredRoutes = {
  // --- PAGE routes (client shells under (app)/admin/layout; authz IS the
  // executed guard:admin-layout + guard:admin-instance role gates) ---------
  "/admin": "client shell; instance-only, under (instance) group; authz = guard:admin-instance (executed)",
  "/admin/health": "client shell; instance-only, under (instance) group; authz = guard:admin-instance (executed)",
  "/admin/settings": "client shell; instance-only, under (instance) group; authz = guard:admin-instance (executed)",
  "/admin/users": "client shell; workspace admin, under (app)/admin/layout; authz = guard:admin-layout (executed)",

  // --- API: requireAdmin family (verified via executed GET config+overview) --
  "/api/admin/ai-test": "requireAdmin; family executed via GET config+overview; POST/side-effecting or duplicate-guard route deferred",
  "/api/admin/health": "requireAdmin; family executed via GET config+overview; POST/side-effecting or duplicate-guard route deferred",
  "/api/admin/smtp-test": "requireAdmin; family executed via GET config+overview; POST/side-effecting or duplicate-guard route deferred",

  // --- API: requireCurrentOrgAdmin family (verified via executed GET invitations) --
  "/api/admin/members": "requireCurrentOrgAdmin; family executed via GET invitations; PATCH/DELETE write path deferred to Playwright",

  // --- API: getUser-401 family (verified via executed GET workspace/members) --
  "/api/ai-notice": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/auth/google": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/auth/google/disconnect": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/billing/upgrade-link": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/calendar/agenda": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/calendar/agenda/start": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/calendar/calendars": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/calendar/events": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/calendar/link": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/calendar/status": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/calendar/unlink": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/calendar/watch": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/companion/authorize": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/companion/heartbeat": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",
  "/api/workspace/directory": "getUser 401 gate; family executed via GET workspace/members; external-integration / write / query-param-branch route deferred",

  // --- API: requireAiAccess family (POST write/stream) ----------------------
  "/api/meetings/[meetingId]/carryover-briefing": "requireAiAccess gate; POST write/stream; allow-side is a write path, deferred to Playwright",
  "/api/meetings/[meetingId]/enhance-notes": "requireAiAccess gate; POST write/stream; allow-side is a write path, deferred to Playwright",
  "/api/meetings/[meetingId]/segments/[seq]/transcribe": "requireAiAccess gate; POST write/stream; allow-side is a write path, deferred to Playwright",
  "/api/meetings/[meetingId]/summary/stream": "requireAiAccess gate; POST write/stream; allow-side is a write path, deferred to Playwright",
  "/api/meetings/[meetingId]/transcribe": "requireAiAccess gate; POST write/stream; allow-side is a write path, deferred to Playwright",

  // --- API: getUser + series-ownership family (series-scoped write) ----------
  "/api/meetings/[meetingId]/send-notes": "getUser + userManagesSeries/canRemind guard; POST/series-scoped write, deferred to Playwright",
  "/api/meetings/[meetingId]/speaker-map": "getUser + userManagesSeries/canRemind guard; POST/series-scoped write, deferred to Playwright",
  "/api/meetings/[meetingId]/suggestions": "getUser + userManagesSeries/canRemind guard; POST/series-scoped write, deferred to Playwright",
  "/api/meetings/[meetingId]/suggestions/[suggestionId]": "getUser + userManagesSeries/canRemind guard; POST/series-scoped write, deferred to Playwright",
  "/api/series/[seriesId]/ask": "getUser + userManagesSeries/canRemind guard; POST/series-scoped write, deferred to Playwright",
  "/api/series/[seriesId]/brief": "getUser + owner/facilitator guard; POST/series-scoped write, deferred to Playwright (e2e/send-brief.spec.ts)",
  "/api/series/[seriesId]/remind": "getUser + userManagesSeries/canRemind guard; POST/series-scoped write, deferred to Playwright",

  // --- API: requireSetupToken bootstrap family ------------------------------
  "/api/setup/check-env": "requireSetupToken bootstrap gate; setup-only POST, deferred",
  "/api/setup/complete": "requireSetupToken bootstrap gate; setup-only POST, deferred",
  "/api/setup/create-admin": "requireSetupToken bootstrap gate; setup-only POST, deferred",
  "/api/setup/seed-demo": "requireSetupToken bootstrap gate; setup-only POST, deferred",

  // --- API: public / token/webhook-authed family (not session authz) --------
  "/api/invite-requests": "public or token/webhook-authed (not session authz); POST/token flow, deferred",
  "/api/invite-requests/actions": "public or token/webhook-authed (not session authz); POST/token flow, deferred",
  "/api/password-reset-requests": "public or token/webhook-authed (not session authz); POST/token flow, deferred",
  "/api/calendar/webhook": "public or token/webhook-authed (not session authz); POST/token flow, deferred",
  "/api/auth/google/callback": "public or token/webhook-authed (not session authz); OAuth state-cookie+code redirect flow, deferred",
  "/api/retro/[token]/graduate": "public or token/webhook-authed (not session authz); POST/token flow, deferred",
  "/api/retro/[token]/suggest-themes": "public or token/webhook-authed (not session authz); POST/token flow, deferred",

  // --- Non-/api route handlers (public, no session authz) -------------------
  "/auth/callback": "public Supabase auth code->session-cookie exchange (authed by OAuth code, not session); redirect flow, deferred",
  "/serwist/[path]": "public PWA service-worker script route (Serwist); static asset, no session authz, deferred",
};

// Fail loud on drift: manifest ids must be exactly the policy node ids.
const manifestIds = manifest.map((n) => n.id).sort();
const policyIds = Object.keys(policy.nodes).sort();
const missingTargets = policyIds.filter((id) => !manifestIds.includes(id));
const orphanTargets = manifestIds.filter((id) => !policyIds.includes(id));
if (missingTargets.length > 0 || orphanTargets.length > 0) {
  throw new Error(
    "nodes.mjs manifest drift vs policy.json:\n" +
      `  policy nodes with no probe target: ${JSON.stringify(missingTargets)}\n` +
      `  probe targets with no policy node: ${JSON.stringify(orphanTargets)}`
  );
}
