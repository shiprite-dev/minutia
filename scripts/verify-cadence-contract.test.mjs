// Guards the meeting-series cadence enum against drift across the four places
// it is declared: the TS union/const (constants.ts), the label map
// (CADENCE_LABELS), the Zod enum (schemas.ts), and the Postgres CHECK
// constraint (migrations). A mismatch silently rejects valid cadences at one
// layer while accepting them at another.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-cadence-"));
const bundled = path.join(tempDir, "constants.mjs");
await esbuild.build({
  entryPoints: ["src/lib/constants.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { CADENCES, CADENCE_LABELS } = await import(pathToFileURL(bundled).href);

const sorted = (values) => [...values].sort();

// All cadence values quoted inside the latest cadence CHECK constraint.
function dbCadences() {
  const file = "supabase/migrations/20260630120000_add_daily_cadence.sql";
  const sql = fs.readFileSync(path.join(root, file), "utf8");
  const inClause = sql.match(/cadence IN \(([^)]+)\)/);
  assert.ok(inClause, `cadence CHECK constraint not found in ${file}`);
  return inClause[1].match(/'([^']+)'/g).map((q) => q.replace(/'/g, ""));
}

// The Zod enum literal in schemas.ts (not exported, so parse the source).
function schemaCadences() {
  const src = fs.readFileSync(path.join(root, "src/lib/schemas.ts"), "utf8");
  const m = src.match(/const cadenceEnum = z\.enum\(\[([^\]]+)\]\)/);
  assert.ok(m, "cadenceEnum not found in src/lib/schemas.ts");
  return m[1].match(/"([^"]+)"/g).map((q) => q.replace(/"/g, ""));
}

test("CADENCE_LABELS covers exactly the CADENCES set", () => {
  assert.deepEqual(sorted(Object.keys(CADENCE_LABELS)), sorted(CADENCES));
});

test("Zod cadence enum matches CADENCES", () => {
  assert.deepEqual(sorted(schemaCadences()), sorted(CADENCES));
});

test("Postgres CHECK constraint matches CADENCES", () => {
  assert.deepEqual(sorted(dbCadences()), sorted(CADENCES));
});

test("daily is a supported cadence everywhere", () => {
  assert.ok(CADENCES.includes("daily"), "CADENCES missing daily");
  assert.ok(CADENCE_LABELS.daily === "Daily", "label for daily must be Daily");
  assert.ok(schemaCadences().includes("daily"), "schema enum missing daily");
  assert.ok(dbCadences().includes("daily"), "DB constraint missing daily");
});
