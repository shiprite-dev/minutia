import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-owner-match-"));
const bundled = path.join(tempDir, "owner-match.mjs");
await esbuild.build({
  entryPoints: ["src/lib/ai/owner-match.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { matchSeriesMember } = await import(pathToFileURL(bundled).href);

const priya = { id: "priya-id", name: "Priya Shah" };
const sam = { id: "sam-id", name: "Sam Lee" };

test("an item named with a member's full name is assigned to that member", () => {
  assert.equal(matchSeriesMember("Priya Shah", [priya, sam]), "priya-id");
  assert.equal(matchSeriesMember("Sam Lee", [priya, sam]), "sam-id");
});

test("an item named with a member's first name in any case is assigned to that member", () => {
  assert.equal(matchSeriesMember("priya", [priya, sam]), "priya-id");
  assert.equal(matchSeriesMember("  PRIYA SHAH ", [priya, sam]), "priya-id");
});

test("a first name shared by two members stays unassigned rather than guessing", () => {
  assert.equal(
    matchSeriesMember("Alex", [
      { id: "alex-kim", name: "Alex Kim" },
      { id: "alex-roe", name: "Alex Roe" },
    ]),
    null,
  );
});

test("a full name wins over a shared first name", () => {
  assert.equal(
    matchSeriesMember("Alex Roe", [
      { id: "alex-kim", name: "Alex Kim" },
      { id: "alex-roe", name: "Alex Roe" },
    ]),
    "alex-roe",
  );
});

test("two members with the same full name stay unassigned, the same member listed twice does not", () => {
  const twin = { id: "priya-2", name: "Priya Shah" };
  assert.equal(matchSeriesMember("Priya Shah", [priya, twin]), null);
  assert.equal(matchSeriesMember("Priya", [priya, priya, sam]), "priya-id");
});

test("an item with no owner name, or a name nobody has, stays unassigned", () => {
  assert.equal(matchSeriesMember(null, [priya, sam]), null);
  assert.equal(matchSeriesMember("", [priya, sam]), null);
  assert.equal(matchSeriesMember("   ", [priya, sam]), null);
  assert.equal(matchSeriesMember("Jordan", [priya, sam]), null);
  assert.equal(matchSeriesMember("Pri", [priya, sam]), null);
});

test("members without a name never match an empty owner", () => {
  assert.equal(matchSeriesMember("", [{ id: "blank", name: "" }]), null);
  assert.equal(
    matchSeriesMember("Priya", [{ id: "blank", name: "" }, priya]),
    "priya-id",
  );
});
