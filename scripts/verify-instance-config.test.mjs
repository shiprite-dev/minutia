import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Instance config reads: a failed read must throw (fail closed), never
// masquerade as unset configuration. Destructive decisions (audio deletion)
// depend on telling those apart. The Supabase client is stubbed at module
// scope via an esbuild plugin; all doubles live here in the test harness.
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-instance-config-"));

const readState = { error: null, rows: [] };
const supabaseCalls = [];

const stubDir = path.join(tempDir, "stubs");
fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(
  path.join(stubDir, "service-role.mjs"),
  `
export function createServiceRoleClient() {
  return {
    from(table) {
      supabaseCalls.push({ op: "from", table });
      const builder = {
        select(cols) { supabaseCalls.push({ op: "select", cols }); return builder; },
        in(col, vals) { supabaseCalls.push({ op: "in", col }); return builder; },
        update(row) { supabaseCalls.push({ op: "update", row }); return builder; },
        eq(col, val) { supabaseCalls.push({ op: "eq", col }); return builder; },
        then(resolve, reject) {
          return Promise.resolve({ data: readState.rows, error: readState.error }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}
`.replace(/supabaseCalls|readState/g, (m) => `globalThis.__stub.${m}`)
);

function stubPlugin() {
  return {
    name: "stub-service-role",
    setup(instance) {
      instance.onResolve({ filter: /^@\/lib\/supabase\/service-role$/ }, () => ({
        path: path.join(stubDir, "service-role.mjs"),
      }));
    },
  };
}

const bundled = path.join(tempDir, "instance-config.mjs");
await esbuild.build({
  entryPoints: ["src/lib/instance-config.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  plugins: [stubPlugin()],
});
const { getInstanceConfigMap, InstanceConfigReadError } = await import(pathToFileURL(bundled).href);

globalThis.__stub = { readState, supabaseCalls };

test("a failed instance_config read throws InstanceConfigReadError", async () => {
  readState.error = { message: "connection refused" };
  readState.rows = [];
  supabaseCalls.length = 0;
  await assert.rejects(
    getInstanceConfigMap(["audio_retention"]),
    (err) => {
      assert.equal(err.name, "InstanceConfigReadError");
      return true;
    }
  );
});

test("a failed read starts no legacy secret migration writes", async () => {
  readState.error = { message: "connection refused" };
  readState.rows = [];
  supabaseCalls.length = 0;
  await assert.rejects(getInstanceConfigMap(["smtp_pass"]));
  assert.equal(
    supabaseCalls.filter((c) => c.op === "update").length,
    0,
    "no legacy encryption write may run when the read failed"
  );
});

test("a successful zero-row read returns an empty map, not an error", async () => {
  readState.error = null;
  readState.rows = [];
  const map = await getInstanceConfigMap(["audio_retention"]);
  assert.deepEqual(map, {});
});

test("a successful plaintext read maps keys to values", async () => {
  readState.error = null;
  readState.rows = [{ key: "audio_retention", value: "keep_forever", encrypted: false }];
  const map = await getInstanceConfigMap(["audio_retention"]);
  assert.equal(map.audio_retention, "keep_forever");
});

test("an absent key in a successful read resolves to null (unset), which callers may default", async () => {
  readState.error = null;
  readState.rows = [];
  const map = await getInstanceConfigMap(["audio_retention"]);
  assert.equal(map.audio_retention, undefined, "key simply missing from the map");
});