#!/usr/bin/env node
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

const checks = [
  ["E2E matrix is configured", /strategy:\n\s+fail-fast:\s+false\n\s+matrix:\n\s+shard:\s+\[1,\s*2,\s*3,\s*4\]/],
  ["E2E job name includes shard", /name:\s+E2E Tests \$\{\{ matrix\.shard \}\}\/4/],
  ["Playwright receives the shard argument", /pnpm test:e2e --shard=\$\{\{ matrix\.shard \}\}\/4/],
  ["Each shard uploads a separate report", /name:\s+playwright-report-\$\{\{ matrix\.shard \}\}/],
  ["Single-worker override is removed", /PLAYWRIGHT_WORKERS:\s+1/],
];

const failures = checks
  .filter(([label, pattern]) => {
    const matched = pattern.test(workflow);
    return label === "Single-worker override is removed" ? matched : !matched;
  })
  .map(([label]) => label);

if (failures.length) {
  console.error("CI Playwright sharding verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("CI Playwright sharding verification passed.");
