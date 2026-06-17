import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle each pure module so node:test can exercise the TS (repo verifier pattern).
async function load(rel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-retro-"));
  const out = path.join(dir, "m.mjs");
  await esbuild.build({ entryPoints: [rel], outfile: out, bundle: true, format: "esm", platform: "node" });
  return import(pathToFileURL(out).href);
}

const { remainingVotes, VOTE_BUDGET } = await load("src/lib/retro/vote-budget.ts");
const { parseDue } = await load("src/lib/retro/parse-due.ts");
const { boardToMarkdown } = await load("src/lib/retro/markdown.ts");
const { TEMPLATES, templateById } = await load("src/lib/retro/templates.ts");
const { RETRO_PHASES, RETRO_PHASE_LABELS, ALL_RETRO_PHASES, RETRO_PHASE_LABEL_LIST } = await load(
  "src/lib/retro/phases.ts"
);

// Pull every `[phase] in ('a','b',...)` list out of the merge migration so the
// DB CHECK constraint and the retro_set_phase RPC can never drift from phases.ts.
function migrationPhaseSets() {
  const sql = fs.readFileSync("supabase/migrations/20260617090000_retro_merge_phases.sql", "utf8");
  return [...sql.matchAll(/phase\s+(?:not\s+)?in\s*\(([^)]*)\)/gi)].map((m) =>
    [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1])
  );
}

test("vote budget caps at 6 and never negative", () => {
  assert.equal(VOTE_BUDGET, 6);
  assert.equal(remainingVotes(0), 6);
  assert.equal(remainingVotes(6), 0);
  assert.equal(remainingVotes(9), 0);
  assert.equal(remainingVotes(-3), 6);
});

test("parseDue resolves ISO dates, leaves free-text null", () => {
  assert.equal(parseDue(""), null);
  assert.equal(parseDue("next sprint"), null);
  assert.equal(parseDue("Fri"), null);
  assert.ok(parseDue("2026-07-01") instanceof Date);
  assert.equal(parseDue("2026-13-99"), null);
});

test("templates expose 4 named boards each with >= 3 columns", () => {
  assert.equal(TEMPLATES.length, 4);
  assert.ok(TEMPLATES.every((t) => Array.isArray(t.columns) && t.columns.length >= 3));
  assert.equal(templateById("ssc")?.name, "Start · Stop · Continue");
  assert.equal(templateById("nope"), undefined);
});

test("retro phases: reveal/theme/vote merged into one ordered ritual", () => {
  assert.deepEqual(RETRO_PHASES, ["lobby", "reflect", "reveal", "discuss", "commit"]);
  assert.ok(!RETRO_PHASES.includes("theme") && !RETRO_PHASES.includes("vote"));
  assert.deepEqual(ALL_RETRO_PHASES, [...RETRO_PHASES, "closed"]);
  // Every persistable phase carries a label; reveal owns the merged step.
  for (const p of ALL_RETRO_PHASES) assert.equal(typeof RETRO_PHASE_LABELS[p], "string");
  assert.equal(RETRO_PHASE_LABELS.reveal, "Reveal & Vote");
  assert.deepEqual(RETRO_PHASE_LABEL_LIST, RETRO_PHASES.map((p) => RETRO_PHASE_LABELS[p]));
});

test("retro phases: DB constraint and RPC mirror phases.ts (no drift)", () => {
  // Skip the legacy-fold subset (`where phase in ('theme','vote')`); the
  // canonical CHECK + RPC lists are the ones spanning the full ritual.
  const sets = migrationPhaseSets().filter((s) => s.includes("lobby"));
  assert.ok(sets.length >= 2, "expected both the CHECK and the RPC phase lists");
  for (const list of sets) assert.deepEqual([...list].sort(), [...ALL_RETRO_PHASES].sort());
});

test("boardToMarkdown renders columns, actions, escapes pipes", () => {
  const md = boardToMarkdown({
    name: "Sprint 24",
    columns: [{ id: "start", title: "Start" }],
    cards: [{ column_id: "start", text: "Pair on a|uth", author_name: "Ada" }],
    actions: [{ text: "Add smoke test", owner_name: "Mara", due: "Fri" }],
  });
  assert.match(md, /# Sprint 24/);
  assert.match(md, /## Start/);
  assert.match(md, /Pair on a\\\|uth, Ada/);
  assert.match(md, /## Action items/);
  assert.match(md, /- \[ \] Add smoke test \(@Mara\), due Fri/);
});
