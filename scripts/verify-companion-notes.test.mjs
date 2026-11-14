import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const entry = "src/lib/ai/companion-notes.ts";
let mod = null;
let buildError = null;
try {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "minutia-companion-notes-"),
  );
  const bundled = path.join(tempDir, "companion-notes.mjs");
  await esbuild.build({
    entryPoints: [entry],
    outfile: bundled,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    absWorkingDir: root,
  });
  mod = await import(pathToFileURL(bundled).href);
} catch (error) {
  buildError = error;
}

function load() {
  assert.ok(
    mod,
    `${entry} must exist and export composeMeetingNotes (${buildError?.message ?? ""})`,
  );
  return mod;
}

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("no companion notes leaves the existing raw-or-notes fallback untouched", () => {
  const { composeMeetingNotes } = load();
  assert.equal(
    composeMeetingNotes({ raw_notes_markdown: "web", notes_markdown: "x" }),
    "web",
  );
  assert.equal(
    composeMeetingNotes({ raw_notes_markdown: "", notes_markdown: "notes" }),
    "notes",
  );
  assert.equal(
    composeMeetingNotes({ raw_notes_markdown: null, notes_markdown: null }),
    "",
  );
  assert.equal(
    composeMeetingNotes({
      raw_notes_markdown: "web",
      notes_markdown: "",
      companion_notes_markdown: "  \n ",
    }),
    "web",
  );
});

test("companion notes alone are returned trimmed, without a heading", () => {
  const { composeMeetingNotes } = load();
  assert.equal(
    composeMeetingNotes({
      raw_notes_markdown: "",
      notes_markdown: "",
      companion_notes_markdown: "\n- ship Friday\n",
    }),
    "- ship Friday",
  );
});

test("web and companion notes are both kept, companion under its heading", () => {
  const { composeMeetingNotes, COMPANION_NOTES_HEADING } = load();
  assert.equal(COMPANION_NOTES_HEADING, "## From the desktop notepad");
  assert.equal(
    composeMeetingNotes({
      raw_notes_markdown: "Agenda: hiring\n\n",
      notes_markdown: "",
      companion_notes_markdown: "- Sam owns the offer\n",
    }),
    "Agenda: hiring\n\n## From the desktop notepad\n\n- Sam owns the offer",
  );
});

test("composition is idempotent when the companion text is already present", () => {
  const { composeMeetingNotes } = load();
  const once = composeMeetingNotes({
    raw_notes_markdown: "web",
    notes_markdown: "",
    companion_notes_markdown: "desk",
  });
  assert.equal(
    composeMeetingNotes({
      raw_notes_markdown: once,
      notes_markdown: "",
      companion_notes_markdown: "desk",
    }),
    once,
  );
});

test("max length matches the desktop clamp and the database CHECK", () => {
  const { COMPANION_NOTES_MAX_LENGTH } = load();
  assert.equal(COMPANION_NOTES_MAX_LENGTH, 100000);
});

test("a migration adds meetings.companion_notes_markdown with a length CHECK", () => {
  const dir = path.join(root, "supabase/migrations");
  const sql = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .find((s) => /ADD COLUMN[^;]*companion_notes_markdown/i.test(s));
  assert.ok(sql, "expected a migration adding companion_notes_markdown");
  assert.match(
    sql,
    /companion_notes_markdown\s+text\s+NOT NULL\s+DEFAULT\s+''/i,
  );
  assert.match(
    sql,
    /char_length\(\s*companion_notes_markdown\s*\)\s*<=\s*100000/i,
  );
});

test("the Meeting type declares companion_notes_markdown", () => {
  assert.match(read("src/lib/types.ts"), /companion_notes_markdown:\s*string/);
});

test("action-item extraction reads the composed notes", () => {
  const src = read("src/lib/ai/suggestions.ts");
  assert.match(src, /composeMeetingNotes\(/);
  assert.doesNotMatch(
    src,
    /const rawNotes = meeting\.raw_notes_markdown \|\| meeting\.notes_markdown/,
  );
});

test("enhance-notes feeds composed notes to the AI but never writes them into raw_notes_markdown", () => {
  const src = read("src/app/api/meetings/[meetingId]/enhance-notes/route.ts");
  assert.match(src, /const notesForAi = composeMeetingNotes\(/);
  assert.match(src, /notes:\s*notesForAi/);
  assert.doesNotMatch(src, /raw_notes_markdown:\s*notesForAi/);
});

test("the meeting page shows companion notes read-only", () => {
  const src = read(
    "src/app/(app)/series/[id]/meetings/[meetingId]/meeting-detail-content.tsx",
  );
  assert.match(src, /companion_notes_markdown/);
  assert.match(src, /From your desktop notepad/);
});
