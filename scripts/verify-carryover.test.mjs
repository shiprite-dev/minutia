import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure carry-over logic so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-carryover-"));
const bundled = path.join(tempDir, "carryover.mjs");
await esbuild.build({
  entryPoints: ["src/lib/ai/carryover.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { summarizeCarryover, parseCarryoverBriefing } = await import(pathToFileURL(bundled).href);

const TODAY = new Date("2026-06-06T00:00:00Z");

const ISSUES = [
  // Overdue, owned, very old -> stale.
  { issue_number: 1, title: "Ship CI", category: "action", status: "open", owner_name: "Sam", due_date: "2026-06-01", created_at: "2026-01-01T00:00:00Z" },
  // Future due, no owner, fresh.
  { issue_number: 2, title: "Draft RFC", category: "info", status: "open", owner_name: null, due_date: "2026-12-01", created_at: "2026-06-05T00:00:00Z" },
  // No due date, owned, old -> stale.
  { issue_number: 3, title: "Coverage gap", category: "risk", status: "in_progress", owner_name: "Lee", due_date: null, created_at: "2026-05-01T00:00:00Z" },
];

test("summarizeCarryover flags overdue items and orders them first", () => {
  const summary = summarizeCarryover(ISSUES, TODAY);
  assert.equal(summary.total, 3);
  assert.equal(summary.issues[0].issue_number, 1);
  assert.equal(summary.issues[0].overdue, true);
  assert.equal(summary.overdue_count, 1);
});

test("summarizeCarryover counts items with no owner", () => {
  const summary = summarizeCarryover(ISSUES, TODAY);
  assert.equal(summary.no_owner_count, 1);
});

test("summarizeCarryover computes days_open and flags stale items", () => {
  const summary = summarizeCarryover(ISSUES, TODAY);
  const first = summary.issues.find((i) => i.issue_number === 1);
  assert.ok(first.days_open > 150, `expected >150 days open, got ${first.days_open}`);
  // Issue 1 (~156d) and issue 3 (~36d) are stale; issue 2 (~1d) is not.
  assert.equal(summary.stale_count, 2);
});

test("summarizeCarryover orders non-overdue by due date with nulls last", () => {
  const summary = summarizeCarryover(ISSUES, TODAY);
  assert.deepEqual(summary.issues.map((i) => i.issue_number), [1, 2, 3]);
});

test("summarizeCarryover returns zeros for an empty list", () => {
  const summary = summarizeCarryover([], TODAY);
  assert.deepEqual(summary, { total: 0, overdue_count: 0, no_owner_count: 0, stale_count: 0, issues: [] });
});

test("parseCarryoverBriefing tolerates markdown-fenced provider JSON", () => {
  const providerData = {
    choices: [
      {
        message: {
          content: "```json\n" + JSON.stringify({
            briefing_markdown: "3 open items, 1 overdue.",
            overdue_count: 1,
            no_owner_count: 1,
          }) + "\n```",
        },
      },
    ],
  };
  const parsed = parseCarryoverBriefing(providerData);
  assert.equal(parsed.briefing_markdown, "3 open items, 1 overdue.");
  assert.equal(parsed.overdue_count, 1);
  assert.equal(parsed.no_owner_count, 1);
});
