// Filesystem coverage gate — nothing on disk escapes classification.
//
// Every src/app/**/page.tsx and src/app/api/**/route.ts must be EITHER executed
// in the authz matrix (present in `manifest`) OR listed in `deferredRoutes` with
// a reason. A new unguarded route that is in neither fails this gate — that is
// the whole point: you cannot ship a route the authz matrix never reasoned about.
// A second test proves the allowlist can't rot: every deferredRoutes key must
// still exist on disk.
//
// Run: node --test scripts/authz/coverage.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { manifest, deferredRoutes } from "./nodes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const appDir = path.join(repoRoot, "src/app");

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const relPosix = (abs) => path.relative(repoRoot, abs).split(path.sep).join("/");
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// src/app/(group)/series/[id]/page.tsx -> /series/:id  (screen-id form)
function pageRoute(rel) {
  const trimmed = rel.replace(/^src\/app/, "").replace(/\/page\.tsx$/, "");
  const segs = trimmed
    .split("/")
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .map((s) => s.replace(/^\[(.+)\]$/, ":$1"));
  return "/" + segs.join("/");
}

// src/app/api/meetings/[meetingId]/transcribe/route.ts -> /api/meetings/[meetingId]/transcribe
// ([param] kept AS-IS, since deferredRoutes api keys use the [param] form).
function apiPath(rel) {
  const trimmed = rel.replace(/^src\/app/, "").replace(/\/route\.ts$/, "");
  const segs = trimmed.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

const allFiles = walk(appDir);
const pageFiles = allFiles.filter((f) => f.endsWith("/page.tsx")).map(relPosix);
const routeFiles = allFiles.filter((f) => f.endsWith("/route.ts")).map(relPosix);

const executedScreenIds = new Set(
  manifest.filter((n) => n.kind === "screen").map((n) => n.id)
);
const executedEndpointIds = manifest.filter((n) => n.kind === "endpoint").map((n) => n.id);

test("coverage: every page.tsx on disk is executed or deferred", () => {
  const unclassified = pageFiles.filter((rel) => {
    const route = pageRoute(rel);
    return !executedScreenIds.has("screen:" + route) && !has(deferredRoutes, route);
  });
  assert.equal(
    unclassified.length,
    0,
    "unclassified page routes (add to manifest as a screen, or to deferredRoutes):\n" +
      JSON.stringify(
        unclassified.map((rel) => ({ file: rel, route: pageRoute(rel) })),
        null,
        2
      )
  );
});

test("coverage: every api/route.ts on disk is executed or deferred", () => {
  const unclassified = routeFiles.filter((rel) => {
    const ap = apiPath(rel);
    const executed = executedEndpointIds.some((id) => id.endsWith(ap));
    return !executed && !has(deferredRoutes, ap);
  });
  assert.equal(
    unclassified.length,
    0,
    "unclassified api routes (add to manifest as an endpoint, or to deferredRoutes):\n" +
      JSON.stringify(
        unclassified.map((rel) => ({ file: rel, path: apiPath(rel) })),
        null,
        2
      )
  );
});

test("coverage: deferredRoutes has no stale entries (every key still on disk)", () => {
  const onDiskPageRoutes = new Set(pageFiles.map(pageRoute));
  const onDiskApiPaths = new Set(routeFiles.map(apiPath));
  const stale = Object.keys(deferredRoutes).filter(
    (k) => !onDiskPageRoutes.has(k) && !onDiskApiPaths.has(k)
  );
  assert.equal(
    stale.length,
    0,
    "stale deferredRoutes keys (route deleted/renamed on disk — remove the entry):\n" +
      JSON.stringify(stale, null, 2)
  );
});
