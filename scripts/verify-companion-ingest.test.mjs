import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure bearer-header parser so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-companion-ingest-"));
const bundled = path.join(tempDir, "bearer.mjs");
await esbuild.build({
  entryPoints: ["src/lib/supabase/bearer.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { bearerTokenFromHeader } = await import(pathToFileURL(bundled).href);

test("bearerTokenFromHeader extracts the token", () => {
  assert.equal(bearerTokenFromHeader("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(bearerTokenFromHeader("bearer abc"), "abc");
});

test("bearerTokenFromHeader rejects malformed headers", () => {
  assert.equal(bearerTokenFromHeader(null), null);
  assert.equal(bearerTokenFromHeader(""), null);
  assert.equal(bearerTokenFromHeader("Bearer"), null);
  assert.equal(bearerTokenFromHeader("Bearer "), null);
  assert.equal(bearerTokenFromHeader("Basic abc"), null);
  assert.equal(bearerTokenFromHeader("Bearer two tokens"), null);
});
