// THE HERMETIC AUTHZ GATE for minutia.
//
// Crawls the whole-app authorization matrix (every policy node × every identity)
// against a bounded fixture Supabase, then asserts (a) the crawl was hermetic —
// zero requests escaped the fixture grammar — and (b) the observed matrix satisfies
// the hand-audited policy.json exactly. Three synthetic negative controls prove the
// checker actually fires (it is not vacuously green).
//
// Run: node --test scripts/authz/verify-authz.test.mjs

import "./env.mjs"; // MUST be first: sets Supabase env so COOKIE_NAME derives at import.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crawl } from "./crawl.mjs";
import { checkPolicy } from "./policy.mjs";
import { manifest } from "./nodes.mjs";
import { baseScenario, uCross } from "./scenarios.mjs";
import { cleanup } from "./bundle.mjs";
import policy from "./policy.json" with { type: "json" };

const here = path.dirname(fileURLToPath(import.meta.url));
const realFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = realFetch;
  delete globalThis.__PROBE_CTX__;
  cleanup();
});

// Shared crawl result — computed once, reused by the gate + all controls.
let matrix;
let aggregate;

test("gate: full authz matrix satisfies policy, hermetically", async () => {
  const scenario = baseScenario;
  ({ matrix, aggregate } = await crawl({ scenario, policy, manifest }));
  globalThis.fetch = realFetch; // crawl left the fixture installed; restore.

  const violations = checkPolicy(matrix, policy, scenario);

  // Always emit the AKG artifact (before any assertion can short-circuit it).
  const artifactDir = path.join(here, "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, "minutia.authz.json"),
    JSON.stringify(aggregate.artifact, null, 2) + "\n"
  );

  assert.equal(
    aggregate.allUnmatched.length,
    0,
    "hermetic: no unmatched requests\n" + JSON.stringify(aggregate.allUnmatched, null, 2)
  );

  assert.equal(
    violations.length,
    0,
    "policy violations:\n" + JSON.stringify(violations, null, 2)
  );
});

// ---------------------------------------------------------------------------
// Synthetic negative controls — mutate a COPY of the green matrix and prove
// checkPolicy detects the injected break. These prove the CHECKER is not vacuous.
// ---------------------------------------------------------------------------
test("negative control (synthetic): checkPolicy DETECTS a reachability leak", () => {
  const m = structuredClone(matrix);
  m["guard:admin-layout"]["member"].outcome = "pass"; // member should be redirect:/

  const violations = checkPolicy(m, policy, baseScenario);
  const leak = violations.find(
    (v) =>
      v.type === "reachability-leak" &&
      v.node === "guard:admin-layout" &&
      v.identity === "member"
  );
  assert.ok(leak, "expected a reachability-leak for guard:admin-layout/member");
});

test("negative control (synthetic): checkPolicy DETECTS a tenant leak", () => {
  const m = structuredClone(matrix);
  const verdict = m["endpoint:GET /api/workspace/members"]["member"];
  verdict.body = verdict.body ?? {};
  verdict.body.members = [...(verdict.body.members ?? []), { id: uCross }];

  const violations = checkPolicy(m, policy, baseScenario);
  const leak = violations.find(
    (v) =>
      v.type === "tenant-leak" &&
      v.node === "endpoint:GET /api/workspace/members" &&
      v.identity === "member" &&
      v.item === uCross
  );
  assert.ok(leak, "expected a tenant-leak naming uCross for workspace/members/member");
});

test("negative control (synthetic): default-deny — an undeclared crawled node fails closed", () => {
  const m = structuredClone(matrix);
  m["screen:/secret"] = { member: { outcome: "pass" } };

  const violations = checkPolicy(m, policy, baseScenario);
  const undeclared = violations.find(
    (v) => v.type === "undeclared-node" && v.node === "screen:/secret"
  );
  assert.ok(undeclared, "expected an undeclared-node violation for screen:/secret");
});
