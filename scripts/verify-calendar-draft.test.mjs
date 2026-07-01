import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure TS module so node:test can exercise it (repo verifier pattern).
async function load(rel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-calendar-"));
  const out = path.join(dir, "m.mjs");
  await esbuild.build({ entryPoints: [rel], outfile: out, bundle: true, format: "esm", platform: "node" });
  return import(pathToFileURL(out).href);
}

const { parseAgendaDrafts, MAX_AGENDA_DRAFTS } = await load("src/lib/calendar/agenda-draft.ts");

function titles(drafts) {
  return drafts.map((d) => d.title);
}

test("labeled lines without markers become drafts with the labelled category", () => {
  assert.deepEqual(parseAgendaDrafts("Action: Ship the build"), [
    { title: "Ship the build", category: "action" },
  ]);
  assert.deepEqual(parseAgendaDrafts("Decision: Adopt trunk-based dev"), [
    { title: "Adopt trunk-based dev", category: "decision" },
  ]);
  assert.deepEqual(parseAgendaDrafts("Discussion: Q3 roadmap"), [
    { title: "Q3 roadmap", category: "info" },
  ]);
  assert.deepEqual(parseAgendaDrafts("TODO: write tests"), [
    { title: "write tests", category: "action" },
  ]);
  assert.deepEqual(parseAgendaDrafts("Risk: vendor lock-in"), [
    { title: "vendor lock-in", category: "risk" },
  ]);
  assert.deepEqual(parseAgendaDrafts("Blocker: missing API key"), [
    { title: "missing API key", category: "blocker" },
  ]);
});

test("bullet lines become info drafts regardless of marker glyph", () => {
  const drafts = parseAgendaDrafts("- Review metrics\n* Plan offsite\n• Check budgets");
  assert.deepEqual(drafts, [
    { title: "Review metrics", category: "info" },
    { title: "Plan offsite", category: "info" },
    { title: "Check budgets", category: "info" },
  ]);
});

test("numbered lines become info drafts", () => {
  const drafts = parseAgendaDrafts("1. First topic\n2) Second topic");
  assert.deepEqual(titles(drafts), ["First topic", "Second topic"]);
  assert.ok(drafts.every((d) => d.category === "info"));
});

test("unchecked checkboxes become action drafts; checked boxes are skipped", () => {
  const drafts = parseAgendaDrafts("- [ ] Send the report\n- [x] Already done\n- [X] Also done");
  assert.deepEqual(drafts, [{ title: "Send the report", category: "action" }]);
});

test("a checkbox following a numbered or bullet marker is parsed cleanly", () => {
  assert.deepEqual(parseAgendaDrafts("1. [ ] Review PR"), [
    { title: "Review PR", category: "action" },
  ]);
  assert.deepEqual(parseAgendaDrafts("2) [x] Already shipped"), []);
  assert.deepEqual(parseAgendaDrafts("- [ ] Send the report"), [
    { title: "Send the report", category: "action" },
  ]);
});

test("a label inside a bullet refines the category and strips the label", () => {
  assert.deepEqual(parseAgendaDrafts("- Action: Fix flaky test"), [
    { title: "Fix flaky test", category: "action" },
  ]);
  assert.deepEqual(parseAgendaDrafts("1. Decision: Use Postgres"), [
    { title: "Use Postgres", category: "decision" },
  ]);
});

test("plain prose without a marker or label is ignored", () => {
  assert.deepEqual(parseAgendaDrafts("We will discuss the launch and review blockers."), []);
  assert.deepEqual(parseAgendaDrafts("Reminder: bring your laptops"), []);
  assert.deepEqual(parseAgendaDrafts("Join the call five minutes early."), []);
});

test("a realistic mixed description drafts each actionable line in order", () => {
  const description = [
    "Weekly sync agenda",
    "",
    "Action: Finalize launch checklist",
    "- Review onboarding metrics",
    "Decision: Pick the rollout date",
    "Some context paragraph that is not an item.",
    "2. Walk through support tickets",
    "- [ ] Confirm on-call schedule",
  ].join("\n");

  assert.deepEqual(parseAgendaDrafts(description), [
    { title: "Finalize launch checklist", category: "action" },
    { title: "Review onboarding metrics", category: "info" },
    { title: "Pick the rollout date", category: "decision" },
    { title: "Walk through support tickets", category: "info" },
    { title: "Confirm on-call schedule", category: "action" },
  ]);
});

test("duplicate titles are drafted once (case-insensitive)", () => {
  const drafts = parseAgendaDrafts("- Review metrics\n- review metrics\nAction: Review metrics");
  assert.deepEqual(drafts, [{ title: "Review metrics", category: "info" }]);
});

test("labels with no following content are skipped", () => {
  assert.deepEqual(parseAgendaDrafts("Action:"), []);
  assert.deepEqual(parseAgendaDrafts("Agenda:"), []);
  assert.deepEqual(parseAgendaDrafts("- [ ]"), []);
});

test("titles are truncated to 500 characters", () => {
  const long = "- " + "x".repeat(800);
  const [draft] = parseAgendaDrafts(long);
  assert.equal(draft.title.length, 500);
});

test("HTML descriptions are normalized before parsing", () => {
  const html = "<ul><li>Review PRs</li><li>Action: Deploy release</li></ul>";
  assert.deepEqual(parseAgendaDrafts(html), [
    { title: "Review PRs", category: "info" },
    { title: "Deploy release", category: "action" },
  ]);
  assert.deepEqual(parseAgendaDrafts("Action: Ship&nbsp;it<br>- Review &amp; merge"), [
    { title: "Ship it", category: "action" },
    { title: "Review & merge", category: "info" },
  ]);
});

test("the number of drafts is capped", () => {
  const many = Array.from({ length: MAX_AGENDA_DRAFTS + 10 }, (_, i) => `- Item ${i}`).join("\n");
  assert.equal(parseAgendaDrafts(many).length, MAX_AGENDA_DRAFTS);
});

test("empty, whitespace, and nullish descriptions produce no drafts", () => {
  assert.deepEqual(parseAgendaDrafts(""), []);
  assert.deepEqual(parseAgendaDrafts("   \n\n  "), []);
  assert.deepEqual(parseAgendaDrafts(null), []);
  assert.deepEqual(parseAgendaDrafts(undefined), []);
});

test("every drafted category is a valid issue category", () => {
  const valid = new Set(["action", "decision", "info", "risk", "blocker"]);
  const drafts = parseAgendaDrafts(
    "Action: a\nDecision: b\nDiscussion: c\nRisk: d\nBlocker: e\n- f\n1. g"
  );
  assert.ok(drafts.length > 0);
  assert.ok(drafts.every((d) => valid.has(d.category)));
});
