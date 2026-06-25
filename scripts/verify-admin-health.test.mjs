import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure admin-health logic so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-admin-health-"));
const bundled = path.join(tempDir, "health.mjs");
await esbuild.build({
  entryPoints: ["src/lib/admin/health.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { configStatus, overallHealth } = await import(pathToFileURL(bundled).href);

test("configStatus maps presence to ok/unconfigured", () => {
  assert.equal(configStatus("smtp.example.com"), "ok");
  assert.equal(configStatus(""), "unconfigured");
  assert.equal(configStatus(null), "unconfigured");
  assert.equal(configStatus(undefined), "unconfigured");
});

test("overallHealth is ok when every probe is ok", () => {
  assert.equal(
    overallHealth([
      { service: "database", status: "ok" },
      { service: "storage", status: "ok" },
      { service: "email", status: "ok" },
    ]),
    "ok"
  );
});

test("overallHealth is degraded when an optional service is unconfigured or degraded", () => {
  assert.equal(
    overallHealth([
      { service: "database", status: "ok" },
      { service: "email", status: "unconfigured" },
    ]),
    "degraded"
  );
  assert.equal(
    overallHealth([
      { service: "database", status: "ok" },
      { service: "storage", status: "degraded" },
    ]),
    "degraded"
  );
});

test("overallHealth is down when the database is down (critical service)", () => {
  assert.equal(
    overallHealth([
      { service: "database", status: "down" },
      { service: "email", status: "ok" },
    ]),
    "down"
  );
});

test("overallHealth is down when any probe reports down", () => {
  assert.equal(
    overallHealth([
      { service: "database", status: "ok" },
      { service: "storage", status: "down" },
    ]),
    "down"
  );
});

test("overallHealth handles empty input as ok", () => {
  assert.equal(overallHealth([]), "ok");
});
