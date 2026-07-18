// Hermetic authz harness — bundling. Lifted verbatim from scripts/verify-authz-spike.test.mjs;
// see that file's history for the reasoning behind each esbuild option and shim.
//
// Bundles real Next.js route guards (middleware, layouts, pages, route handlers) to a temp
// dir with esbuild, then imports them as plain ESM so they can run headlessly in Node against
// a fixture fetch. next/headers + next/navigation are shimmed; next/server is bundled REAL.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();

// ---------------------------------------------------------------------------
// next/headers + next/navigation shims. cookies()/headers() read from
// globalThis.__PROBE_CTX__ = { cookies: [{name,value}], headers: {lowercased: value} },
// set by the caller before invoking bundled server code. redirect()/notFound() throw the
// real Next digest strings so guard code's control flow (and callers' assertions on the
// digest) behave exactly as in the real app.
// ---------------------------------------------------------------------------
export const shimPlugin = {
  name: "next-shims",
  setup(build) {
    build.onResolve({ filter: /^next\/(headers|navigation)$/ }, (a) => ({
      path: a.path,
      namespace: "next-shim",
    }));
    build.onLoad({ filter: /.*/, namespace: "next-shim" }, (a) => {
      if (a.path === "next/headers") {
        return {
          loader: "js",
          contents: `
            export async function cookies() {
              const ctx = globalThis.__PROBE_CTX__ || { cookies: [], headers: {} };
              const jar = ctx.cookies || [];
              return {
                getAll() { return jar.map((c) => ({ name: c.name, value: c.value })); },
                get(name) { const f = jar.find((c) => c.name === name); return f ? { name: f.name, value: f.value } : undefined; },
                set() {},
              };
            }
            export async function headers() {
              const ctx = globalThis.__PROBE_CTX__ || { cookies: [], headers: {} };
              const h = ctx.headers || {};
              return { get(name) { const v = h[String(name).toLowerCase()]; return v == null ? null : v; } };
            }
          `,
        };
      }
      return {
        loader: "js",
        contents: `
          export function redirect(url) {
            throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;" + url + ";307;" });
          }
          export function notFound() {
            throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
          }
          export function usePathname() { throw new Error("usePathname stub"); }
          export function useRouter() { throw new Error("useRouter stub"); }
          export function useSearchParams() { throw new Error("useSearchParams stub"); }
          export function useParams() { throw new Error("useParams stub"); }
        `,
      };
    });
  },
};

export const buildOpts = {
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  jsx: "automatic",
  // next/server is bundled REAL, but some of its transitive CJS deps (ua-parser)
  // reference __dirname/require at module scope. An ESM bundle has neither, so
  // provide them via a banner backed by createRequire(import.meta.url).
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'module';",
      "import { fileURLToPath as __fileURLToPath } from 'url';",
      "import { dirname as __pathDirname } from 'path';",
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __pathDirname(__filename);",
    ].join("\n"),
  },
  loader: { ".css": "empty", ".svg": "empty", ".png": "empty", ".jpg": "empty", ".woff2": "empty" },
  plugins: [shimPlugin],
};

export const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-authz-harness-"));

const builtFiles = new Map(); // outName -> absolute outfile path, so repeat calls skip re-bundling

// ---------------------------------------------------------------------------
// bundleModule — bundle once per outName, import (optionally cache-busted) every call.
// source is either { entry: '<relpath-from-repo-root>' } or { stdin: '<ts source>' }.
// A cachebust token forces a fresh module instance (fresh module-level state, e.g.
// middleware's setupCompletedCache) by appending `?fresh=<token>` to the import URL
// without re-running esbuild.
// ---------------------------------------------------------------------------
export async function bundleModule(source, outName, { cachebust } = {}) {
  let outfile = builtFiles.get(outName);
  if (!outfile) {
    outfile = path.join(tempDir, outName);
    const opts = source.entry
      ? { ...buildOpts, entryPoints: [source.entry], outfile }
      : { ...buildOpts, stdin: { contents: source.stdin, resolveDir: root, loader: "ts" }, outfile };
    await esbuild.build(opts);
    builtFiles.set(outName, outfile);
  }
  const href = pathToFileURL(outfile).href + (cachebust ? `?fresh=${cachebust}` : "");
  return import(href);
}

// ---------------------------------------------------------------------------
// bundleMiddleware — wrapper-entry trick: bundle the REAL middleware and re-export
// NextRequest/NextResponse from the same graph, so next/server is bundled exactly once
// and the NextRequest constructed by callers is the same class the middleware reads (no
// two-copy skew). Bare `import "next/server"` isn't resolvable under plain Node ESM
// (next's export conditions), which is why this goes through esbuild.
// ---------------------------------------------------------------------------
export async function bundleMiddleware({ cachebust } = {}) {
  const stdin =
    `export { middleware, config } from ${JSON.stringify(path.join(root, "src/middleware.ts"))};\n` +
    `export { NextRequest, NextResponse } from "next/server";`;
  const ns = await bundleModule({ stdin }, "middleware.mjs", { cachebust });
  return { middleware: ns.middleware, config: ns.config, NextRequest: ns.NextRequest, NextResponse: ns.NextResponse };
}

// ---------------------------------------------------------------------------
// bundleServerComponent — bundle a real layout/page/route-handler entry (relPath from
// repo root) and return its imported module namespace (default export = the component,
// or GET/POST/etc. for route handlers).
// ---------------------------------------------------------------------------
export async function bundleServerComponent(relPath, { cachebust } = {}) {
  const outName = relPath.replace(/[\\/]/g, "_").replace(/\.[tj]sx?$/, "") + ".mjs";
  return bundleModule({ entry: relPath }, outName, { cachebust });
}

export function cleanup() {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}
