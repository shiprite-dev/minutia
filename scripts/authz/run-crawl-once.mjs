// Fresh-process crawl entry for the real-code negative controls (negcontrol.mjs).
//
// Bundling caches by output name WITHIN a process, so to observe a source
// mutation the crawl must run in a NEW process — this is that process. It crawls
// the base scenario, checks it against policy.json, and prints the violations as
// JSON on the last stdout line. negcontrol.mjs spawns this after mutating a real
// guard/tenant-check and asserts the expected violation appears (then reverts).

import "./env.mjs"; // MUST be first.

import { crawl } from "./crawl.mjs";
import { checkPolicy } from "./policy.mjs";
import { manifest } from "./nodes.mjs";
import { baseScenario } from "./scenarios.mjs";
import policy from "./policy.json" with { type: "json" };

const realFetch = globalThis.fetch;
try {
  const { matrix } = await crawl({ scenario: baseScenario, policy, manifest });
  const violations = checkPolicy(matrix, policy, baseScenario);
  globalThis.fetch = realFetch;
  // Sentinel-wrapped so the parent can extract it unambiguously.
  console.log("__VIOLATIONS__" + JSON.stringify(violations));
} catch (err) {
  globalThis.fetch = realFetch;
  console.log("__CRAWL_ERROR__" + String(err?.stack ?? err));
  process.exit(2);
}
