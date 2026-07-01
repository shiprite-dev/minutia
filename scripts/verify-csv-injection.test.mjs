import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-csv-injection-"));
const bundled = path.join(tempDir, "export.mjs");

await esbuild.build({
  entryPoints: ["src/lib/export.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});

const { issuesToCsv } = await import(pathToFileURL(bundled).href);

function makeIssue(title, description = "") {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    series_id: "00000000-0000-0000-0000-000000000002",
    issue_number: 1,
    title,
    description,
    category: "ops",
    status: "open",
    priority: "medium",
    owner_name: null,
    due_date: null,
    created_at: "2026-07-01T00:00:00Z",
    resolved_in_meeting_id: null,
    raised_in_meeting_id: null,
    owner_user_id: null,
    source: "manual",
  };
}

function csvRows(csv) {
  return csv.split("\n").slice(1); // drop header row
}

// --- Formula injection neutralization ---

test("= prefix is neutralized with single quote", () => {
  const csv = issuesToCsv([makeIssue("=HYPERLINK(\"evil.com\")")]);
  const row = csvRows(csv)[0];
  assert.ok(row.includes("'=HYPERLINK"), `expected neutralized formula, got: ${row}`);
  assert.ok(!row.match(/^=|,"=/), `raw formula must not appear unquoted: ${row}`);
});

test("+ prefix is neutralized with single quote", () => {
  const csv = issuesToCsv([makeIssue("+cmd|' /C calc'!A0")]);
  const row = csvRows(csv)[0];
  assert.ok(row.includes("'+cmd"), `expected neutralized formula, got: ${row}`);
});

test("- prefix is neutralized with single quote", () => {
  const csv = issuesToCsv([makeIssue("-2+3+cmd|' /C calc'!A0")]);
  const row = csvRows(csv)[0];
  assert.ok(row.includes("'-2+3"), `expected neutralized formula, got: ${row}`);
});

test("@ prefix is neutralized with single quote", () => {
  const csv = issuesToCsv([makeIssue("@SUM(1,2)")]);
  const row = csvRows(csv)[0];
  assert.ok(row.includes("'@SUM"), `expected neutralized formula, got: ${row}`);
});

test("TAB prefix is neutralized with single quote", () => {
  const csv = issuesToCsv([makeIssue("\t=SUM(1,2)")]);
  const row = csvRows(csv)[0];
  assert.ok(row.includes("'\t=SUM"), `expected neutralized formula, got: ${row}`);
});

test("CR prefix is neutralized with single quote", () => {
  const csv = issuesToCsv([makeIssue("\r=SUM(1,2)")]);
  const row = csvRows(csv)[0];
  assert.ok(row.includes("'\r=SUM"), `expected neutralized formula, got: ${row}`);
});

// --- Normal values pass through unchanged ---

test("normal value is not prefixed", () => {
  const csv = issuesToCsv([makeIssue("Fix the login bug")]);
  const row = csvRows(csv)[0];
  assert.ok(row.includes("Fix the login bug"), `normal value must pass through: ${row}`);
  assert.ok(!row.includes("'Fix"), `normal value must not be prefixed: ${row}`);
});

test("empty string is not prefixed", () => {
  const csv = issuesToCsv([makeIssue("", "")]);
  // Should not throw, headers still present
  assert.ok(csv.length > 0);
});

test("value with comma is RFC-4180 quoted", () => {
  const csv = issuesToCsv([makeIssue("Hello, world")]);
  const row = csvRows(csv)[0];
  assert.ok(row.includes('"Hello, world"'), `comma value must be quoted: ${row}`);
});

test("formula with comma is both neutralized and RFC-4180 quoted", () => {
  const csv = issuesToCsv([makeIssue("=SUM(A1,A2)")]);
  const row = csvRows(csv)[0];
  // After prefix the field becomes "'=SUM(A1,A2)" which contains a comma, so RFC-4180 wraps it.
  assert.ok(row.includes(`"'=SUM(A1,A2)"`), `formula with comma must be neutralized and quoted: ${row}`);
});
