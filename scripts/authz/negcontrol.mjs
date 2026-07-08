// REAL-CODE negative controls — the proof the authz gate cannot lie.
//
// A gate that never goes red when the system is broken is worthless. This script
// mutates REAL minutia source (a real route guard, and a real tenant filter),
// runs the full crawl in a fresh process, and asserts the gate produces the
// expected named violation — then RESTORES the source (try/finally, always).
// It is not a committed CI test (it edits src/ transiently); it is a runnable,
// reproducible proof. Run: node scripts/authz/negcontrol.mjs
//
// Unlike the synthetic controls in verify-authz.test.mjs (which tamper the matrix
// data structure), these prove the WHOLE pipeline — real middleware/guard/handler
// execution through the fixture — flips red on a real defect.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const crawlOnce = path.join(here, "run-crawl-once.mjs");

const UCROSS = "40000000-0000-4000-8000-000000000004"; // org B member (scenarios.mjs)

const controls = [
  {
    name: "A: neuter the admin role guard (real src/app/(app)/admin/layout.tsx)",
    file: "src/app/(app)/admin/layout.tsx",
    find: 'if (profile?.role !== "admin") redirect("/");',
    replace: 'if (false) redirect("/");',
    expect(violations) {
      // Non-admins that were redirected now reach the admin layout -> leaks.
      const leaks = violations.filter(
        (v) => v.type === "reachability-leak" && v.node === "guard:admin-layout"
      );
      const identities = new Set(leaks.map((v) => v.identity));
      const wanted = ["member", "orgAdmin", "crossTenant", "proMember"];
      const missing = wanted.filter((i) => !identities.has(i));
      if (leaks.length === 0) return "no reachability-leak on guard:admin-layout";
      if (missing.length) return `missing leak for: ${missing.join(", ")}`;
      return null; // pass: the guard leak fired for every non-admin
    },
  },
  {
    name: "B: drop the org tenant filter (real src/app/api/workspace/members/route.ts)",
    file: "src/app/api/workspace/members/route.ts",
    find: '    .eq("organization_id", organizationId)\n    .order("joined_at", { ascending: true });',
    replace: '    .order("joined_at", { ascending: true });',
    expect(violations) {
      const leaks = violations.filter(
        (v) =>
          v.type === "tenant-leak" &&
          v.node === "endpoint:GET /api/workspace/members"
      );
      if (leaks.length === 0) return "no tenant-leak on workspace/members";
      // An org-A caller (e.g. member) must now see the org-B member uCross.
      const memberSeesCross = leaks.some(
        (v) => v.identity === "member" && v.item === UCROSS
      );
      if (!memberSeesCross)
        return `expected member to leak org-B user ${UCROSS}; got ${JSON.stringify(
          leaks.map((v) => ({ id: v.identity, item: v.item }))
        )}`;
      return null;
    },
  },
];

function runCrawlViolations() {
  const out = execFileSync("node", [crawlOnce], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const line = out
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("__VIOLATIONS__"));
  if (!line) throw new Error("crawl produced no __VIOLATIONS__ output");
  return JSON.parse(line.slice("__VIOLATIONS__".length));
}

let allPassed = true;
const results = [];

for (const control of controls) {
  const abs = path.join(repoRoot, control.file);
  const original = fs.readFileSync(abs, "utf8");

  if (!original.includes(control.find)) {
    // Fail loud: the control must actually mutate real code, never silently no-op.
    results.push({ name: control.name, ok: false, reason: `target string not found in ${control.file}` });
    allPassed = false;
    continue;
  }

  try {
    fs.writeFileSync(abs, original.replace(control.find, control.replace), "utf8");
    const violations = runCrawlViolations();
    const problem = control.expect(violations);
    if (problem) {
      results.push({ name: control.name, ok: false, reason: problem, violationCount: violations.length });
      allPassed = false;
    } else {
      results.push({ name: control.name, ok: true, violationCount: violations.length });
    }
  } finally {
    fs.writeFileSync(abs, original, "utf8"); // ALWAYS restore
  }
}

console.log("\n=== REAL-CODE NEGATIVE CONTROLS ===\n");
for (const r of results) {
  console.log(`${r.ok ? "RED as expected ✓" : "DID NOT GO RED ✗"}  ${r.name}`);
  if (r.violationCount != null) console.log(`    (${r.violationCount} violations produced)`);
  if (!r.ok) console.log(`    reason: ${r.reason}`);
}
console.log(
  `\n${allPassed ? "ALL CONTROLS PASSED — the gate goes red on real defects and green when reverted." : "A CONTROL FAILED — investigate before trusting the gate."}\n`
);
process.exit(allPassed ? 0 : 1);
