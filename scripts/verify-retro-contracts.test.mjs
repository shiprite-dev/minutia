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

test("boardToMarkdown renders columns, actions, escapes pipes", () => {
  const md = boardToMarkdown({
    name: "Sprint 24",
    columns: [{ id: "start", title: "Start" }],
    cards: [{ column_id: "start", text: "Pair on a|uth", author_name: "Ada" }],
    actions: [{ text: "Add smoke test", owner_name: "Mara", due: "Fri" }],
  });
  assert.match(md, /# Sprint 24/);
  assert.match(md, /## Start/);
  assert.match(md, /Pair on a\\\|uth — Ada/);
  assert.match(md, /## Action items/);
  assert.match(md, /- \[ \] Add smoke test \(@Mara\) — due Fri/);
});
