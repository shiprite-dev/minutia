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
const { applyRetroEvent } = await load("src/lib/retro/apply-event.ts");

// Minimal snapshot fixture for the realtime reducer tests.
function baseSnap(overrides = {}) {
  return {
    board: { id: "b", name: "", template: "", columns: [], phase: "reveal", phase_started_at: null, settings: {}, saved_to_series_id: null, expires_at: "" },
    participants: [],
    cards: [{ id: "c1", column_id: "col", author_key: "a", author_name: "A", color: "sky", text: "hi", group_id: null, sort_order: 0 }],
    votes: {},
    my_votes: [],
    actions: [],
    carryover: [],
    ...overrides,
  };
}

// Pull every `[phase] in ('a','b',...)` list out of the merge migration so the
// DB CHECK constraint and the retro_set_phase RPC can never drift from phases.ts.
function migrationPhaseSets() {
  const sql = fs.readFileSync("supabase/migrations/20260617090000_retro_merge_phases.sql", "utf8");
  return [...sql.matchAll(/phase\s+(?:not\s+)?in\s*\(([^)]*)\)/gi)].map((m) =>
    [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1])
  );
}

function endMigration() {
  return fs.readFileSync("supabase/migrations/20260619090000_retro_end.sql", "utf8");
}

// Every RPC that mutates a live board must call _retro_assert_live(b) so an
// ended board is frozen for everyone. retro_snapshot is deliberately excluded
// (the summary still loads from it). Guards against a future RPC skipping it.
const LIVE_GUARDED_RPCS = [
  "retro_join", "retro_add_card", "retro_update_card", "retro_delete_card",
  "retro_vote", "retro_set_card_group", "retro_set_phase",
  "retro_add_action", "retro_update_action", "retro_delete_action",
];

// Slice exactly one function definition: from its CREATE to its closing $$;
// delimiter, so inter-function comments never leak into the body assertions.
function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start === -1) return null;
  const end = sql.indexOf("$$;", start);
  return end === -1 ? sql.slice(start) : sql.slice(start, end + 3);
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

test("applyRetroEvent: phase.changed updates board phase (new ref)", () => {
  const s = baseSnap();
  const n = applyRetroEvent(s, { t: "phase.changed", phase: "discuss" }, null);
  assert.equal(n.board.phase, "discuss");
  assert.notEqual(n, s);
  // No-op when already in that phase (same ref -> caller skips refetch).
  assert.equal(applyRetroEvent(n, { t: "phase.changed", phase: "discuss" }, null), n);
});

test("applyRetroEvent: vote.changed applies authoritative count, clamps >= 0, no-ops when unchanged", () => {
  const s = baseSnap({ votes: { c1: 2 } });
  assert.equal(applyRetroEvent(s, { t: "vote.changed", card_id: "c1", count: 3 }, null).votes.c1, 3);
  assert.equal(applyRetroEvent(s, { t: "vote.changed", card_id: "c1", count: -5 }, null).votes.c1, 0);
  // Same count -> same reference (caller refetches instead of re-rendering).
  assert.equal(applyRetroEvent(s, { t: "vote.changed", card_id: "c1", count: 2 }, null), s);
});

test("applyRetroEvent: card.deleted removes the card", () => {
  const s = baseSnap();
  assert.equal(applyRetroEvent(s, { t: "card.deleted", key: "a", card_id: "c1" }, null).cards.length, 0);
  // Deleting an unknown card is a no-op (same ref).
  assert.equal(applyRetroEvent(s, { t: "card.deleted", key: "a", card_id: "nope" }, null), s);
});

test("applyRetroEvent: card.added appends and dedupes by id", () => {
  const s = baseSnap();
  const card = { id: "c2", column_id: "col", author_key: "a", author_name: "A", color: "rose", text: "new", group_id: null, sort_order: 1 };
  const n = applyRetroEvent(s, { t: "card.added", key: "a", card }, "a");
  assert.equal(n.cards.length, 2);
  assert.equal(applyRetroEvent(n, { t: "card.added", key: "a", card }, "a").cards.length, 2);
});

test("applyRetroEvent: card.updated patches text and color", () => {
  const s = baseSnap();
  const card = { id: "c1", column_id: "col", author_key: "a", author_name: "A", color: "amber", text: "edited", group_id: null, sort_order: 0 };
  const n = applyRetroEvent(s, { t: "card.updated", key: "a", card }, "a");
  assert.equal(n.cards[0].text, "edited");
  assert.equal(n.cards[0].color, "amber");
});

test("applyRetroEvent: payload-less and unresolvable events no-op (signal refetch)", () => {
  const s = baseSnap();
  assert.equal(applyRetroEvent(s, { t: "card.added", key: "a" }, "a"), s);
  assert.equal(applyRetroEvent(s, { t: "card.updated", key: "a" }, "a"), s);
  assert.equal(applyRetroEvent(s, { t: "action.changed" }, "a"), s);
  assert.equal(applyRetroEvent(s, { t: "carry.toggled", id: "x" }, "a"), s);
});

test("applyRetroEvent: redacts another author's card text during Reflect", () => {
  const reflect = baseSnap({ board: { ...baseSnap().board, phase: "reflect" } });
  const card = { id: "c3", column_id: "col", author_key: "someone-else", author_name: "Z", color: "sage", text: "secret", group_id: null, sort_order: 2 };
  const asPeer = applyRetroEvent(reflect, { t: "card.added", key: "x", card }, "me-not-author");
  const seen = asPeer.cards.find((c) => c.id === "c3");
  assert.equal(seen.text, "");
  assert.equal(seen.author_name, "");
  // The author still sees their own card unredacted.
  const asAuthor = applyRetroEvent(reflect, { t: "card.added", key: "x", card }, "someone-else");
  assert.equal(asAuthor.cards.find((c) => c.id === "c3").text, "secret");
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

test("retro_end migration: adds ended_at column, helper, and idempotent RPC", () => {
  const sql = endMigration();
  assert.match(sql, /alter table public\.retro_boards\s+add column[\s\S]*ended_at\s+timestamptz/i);
  assert.match(sql, /create or replace function public\._retro_assert_live\s*\(/i);
  assert.match(sql, /create or replace function public\.retro_end\s*\(\s*p_ftoken text\s*\)/i);
  // retro_end must be idempotent and gate on the sealed phase.
  const end = fnBody(sql, "retro_end");
  assert.ok(end, "retro_end function present");
  assert.match(end, /already_ended/);
  assert.match(end, /'closed'/);
});

test("retro_end migration: snapshot returns ended_at and never asserts live", () => {
  const sql = endMigration();
  const snap = fnBody(sql, "retro_snapshot");
  assert.ok(snap, "retro_snapshot redefined");
  assert.match(snap, /'ended_at',\s*b\.ended_at/i);
  assert.doesNotMatch(snap, /_retro_assert_live/);
});

test("retro_end migration: every live-mutation RPC asserts the board is live", () => {
  const sql = endMigration();
  for (const name of LIVE_GUARDED_RPCS) {
    const body = fnBody(sql, name);
    assert.ok(body, `${name} redefined in the end migration`);
    assert.match(body, /_retro_assert_live\s*\(\s*b\s*\)/, `${name} must call _retro_assert_live(b)`);
  }
});

test("retro_end migration: helper revoked from anon, RPC granted to anon", () => {
  const sql = endMigration();
  assert.match(sql, /revoke[\s\S]*_retro_assert_live[\s\S]*from[\s\S]*anon/i);
  assert.match(sql, /grant execute on function[\s\S]*public\.retro_end\(text\)[\s\S]*to anon/i);
});
