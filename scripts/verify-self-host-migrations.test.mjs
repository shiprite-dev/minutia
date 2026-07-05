// Contract: the self-host Docker stack must apply the app schema on `up`.
//
// The app migrations reference auth.users (created by GoTrue at boot) and
// storage.buckets (created by storage-api at boot), so they cannot run in
// Postgres init. A one-shot `supabase-migrate` service applies them after both
// are healthy, and the web app waits for it before serving. If this wiring is
// dropped, a fresh `docker compose up -d` boots empty roles with no tables and
// /setup fails, but every CI E2E shard stays green (CI uses `supabase start`,
// not this compose path). This guard fails loudly when the wiring regresses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");

// Slice a top-level (2-space indented) service block out of the compose file.
function serviceBlock(name) {
  const lines = compose.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i]) || /^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("compose defines a one-shot supabase-migrate service that runs the applier", () => {
  const block = serviceBlock("supabase-migrate");
  assert.ok(block, "supabase-migrate service is missing from docker-compose.yml");
  assert.match(
    block,
    /run-self-host-migrations\.sh/,
    "supabase-migrate must run scripts/run-self-host-migrations.sh",
  );
});

test("migrate waits for auth and storage (auth.users / storage.buckets must exist first)", () => {
  const block = serviceBlock("supabase-migrate");
  assert.match(
    block,
    /supabase-auth:\s*\n\s*condition:\s*service_healthy/,
    "supabase-migrate must depend on supabase-auth: service_healthy",
  );
  assert.match(
    block,
    /supabase-storage:\s*\n\s*condition:\s*service_healthy/,
    "supabase-migrate must depend on supabase-storage: service_healthy",
  );
});

test("web waits for migrations to finish before it serves", () => {
  const block = serviceBlock("minutia-web");
  assert.ok(block, "minutia-web service is missing from docker-compose.yml");
  assert.match(
    block,
    /supabase-migrate:\s*\n\s*condition:\s*service_completed_successfully/,
    "minutia-web must depend on supabase-migrate: service_completed_successfully",
  );
});
