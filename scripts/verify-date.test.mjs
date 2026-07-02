import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-date-"));
const bundled = path.join(tempDir, "date.mjs");
await esbuild.build({
  entryPoints: ["src/lib/date-utils.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { toLocalISODate } = await import(pathToFileURL(bundled).href);

test("formats a locally-constructed date as the day the user sees, in any TZ", () => {
  // A calendar click yields a Date at LOCAL midnight. Reading local fields must
  // return that same calendar day regardless of the runner's timezone.
  assert.equal(toLocalISODate(new Date(2026, 6, 10)), "2026-07-10"); // month is 0-based
  assert.equal(toLocalISODate(new Date(2026, 0, 1)), "2026-01-01");
  assert.equal(toLocalISODate(new Date(2026, 11, 31)), "2026-12-31");
});

test("zero-pads month and day", () => {
  assert.equal(toLocalISODate(new Date(2026, 2, 5)), "2026-03-05");
});

test("does NOT shift the date backward the way toISOString() does in +TZ", () => {
  // Regression guard for the due-date off-by-one: local midnight on the 10th
  // must never serialize to the 9th.
  const picked = new Date(2026, 6, 10, 0, 0, 0);
  assert.equal(toLocalISODate(picked), "2026-07-10");
});
