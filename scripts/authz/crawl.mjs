// The crawl — bundle every probe target ONCE, then run the full
// (node × identity) matrix against a fresh fixture. Returns the raw matrix of
// verdicts plus an aggregate (hermeticity gaps + an AKG-shaped artifact).
//
// The fixture is installed on globalThis.fetch here and left in place; the CALLER
// restores the real fetch (so it can inspect verdicts under the seam first).

import { bundleMiddleware, bundleServerComponent } from "./bundle.mjs";
import { makeFixture } from "./fixture.mjs";
import { probeScreen, probeGuard, probeEndpoint } from "./probe.mjs";

function isReach(verdict) {
  return verdict.outcome === "pass";
}

export async function crawl({ scenario, policy, manifest }) {
  const fx = makeFixture(scenario);
  globalThis.fetch = fx.fetch;

  // Bundle once, reuse across identities. No cachebust: the middleware's
  // setupCompletedCache is intentionally SHARED across every probe here — the
  // scenario holds setup_completed constant ('true'), so a stale cache is
  // correct. A setup-incomplete scenario would need a fresh bundle per probe.
  const mw = await bundleMiddleware();
  const guardModules = new Map();
  const endpointModules = new Map();
  for (const node of manifest) {
    if (node.kind === "guard") {
      guardModules.set(node.id, await bundleServerComponent(node.module));
    } else if (node.kind === "endpoint") {
      endpointModules.set(node.id, await bundleServerComponent(node.module));
    }
  }

  const matrix = {};
  for (const node of manifest) {
    matrix[node.id] = {};
    for (const identityName of policy.identities) {
      const identity = scenario.identities[identityName];
      fx.reset();

      let verdict;
      if (node.kind === "screen") {
        verdict = await probeScreen(node.url, identity, mw);
      } else if (node.kind === "guard") {
        verdict = await probeGuard(identity, guardModules.get(node.id));
      } else {
        verdict = await probeEndpoint(
          identity,
          endpointModules.get(node.id),
          node.method,
          node.url,
          mw
        );
      }

      verdict.requests = [...fx.requestLog];
      verdict.unmatched = [...fx.unmatched];
      matrix[node.id][identityName] = verdict;
    }
  }

  // --- Aggregate: hermeticity gaps ------------------------------------------
  const allUnmatched = [];
  const unmatchedOnExpectedReach = [];
  for (const node of manifest) {
    for (const identityName of policy.identities) {
      const verdict = matrix[node.id][identityName];
      if (verdict.unmatched.length > 0) {
        const entry = { node: node.id, identity: identityName, unmatched: verdict.unmatched };
        allUnmatched.push(entry);
        const expected = policy.nodes[node.id]?.expect?.[identityName];
        if (expected === "pass") unmatchedOnExpectedReach.push(entry);
      }
    }
  }

  // --- Aggregate: AKG-shaped artifact ---------------------------------------
  const artifact = {
    specVersion: "0.1.0-authz",
    scenario: "minutia-base",
    nodes: manifest.map((node) => ({
      id: node.id,
      kind: node.kind,
      reachableBy: policy.identities.filter((identityName) =>
        isReach(matrix[node.id][identityName])
      ),
    })),
    generatedFrom: "crawl",
  };

  return { matrix, aggregate: { allUnmatched, unmatchedOnExpectedReach, artifact } };
}
