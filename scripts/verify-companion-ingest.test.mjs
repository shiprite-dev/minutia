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

const segmentsBundled = path.join(tempDir, "segments.mjs");
await esbuild.build({
  entryPoints: ["src/lib/audio/segments.ts"],
  outfile: segmentsBundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { segmentStoragePath, parseSegmentPath, segmentMimeForExt } = await import(
  pathToFileURL(segmentsBundled).href
);

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

test("segmentStoragePath keeps webm default and accepts m4a", () => {
  assert.equal(segmentStoragePath("m1", 0), "m1/seg-0.webm");
  assert.equal(segmentStoragePath("m1", 3, "m4a"), "m1/seg-3.m4a");
});

test("parseSegmentPath accepts exactly the canonical shapes", () => {
  assert.deepEqual(parseSegmentPath("m1", 0, "m1/seg-0.webm"), { ext: "webm" });
  assert.deepEqual(parseSegmentPath("m1", 7, "m1/seg-7.m4a"), { ext: "m4a" });
});

test("parseSegmentPath rejects everything else", () => {
  assert.equal(parseSegmentPath("m1", 0, "m2/seg-0.webm"), null);      // wrong meeting
  assert.equal(parseSegmentPath("m1", 0, "m1/seg-1.webm"), null);      // wrong seq
  assert.equal(parseSegmentPath("m1", 0, "m1/seg-0.exe"), null);       // bad ext
  assert.equal(parseSegmentPath("m1", 0, "m1/../x/seg-0.webm"), null); // traversal
  assert.equal(parseSegmentPath("m1", 0, 42), null);                   // non-string
  assert.equal(parseSegmentPath("m1", 0, undefined), null);
});

test("segmentMimeForExt maps to bucket-allowed mimes", () => {
  assert.equal(segmentMimeForExt("webm"), "audio/webm");
  assert.equal(segmentMimeForExt("m4a"), "audio/mp4");
});
