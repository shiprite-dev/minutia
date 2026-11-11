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
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
const kongTemplate = readFileSync(join(root, "docker", "kong.yml"), "utf8");
const migrateScript = readFileSync(join(root, "scripts", "run-self-host-migrations.sh"), "utf8");
const ciWorkflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");

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

// The default `docker compose up -d` must run the PRODUCTION build. A dev overlay
// named docker-compose.override.yml auto-loads and silently swaps the web app to
// `pnpm dev` (Next.js dev server) built from the `deps` stage, and exposes Postgres
// to the host. The dev overlay must be opt-in (docker-compose.dev.yml), never the
// auto-loaded override.
test("no auto-loaded dev override; the dev overlay is opt-in", () => {
  assert.ok(
    !existsSync(join(root, "docker-compose.override.yml")),
    "docker-compose.override.yml auto-loads on `docker compose up` and forces dev mode; rename it to docker-compose.dev.yml (opt-in)",
  );
  const dev = join(root, "docker-compose.dev.yml");
  assert.ok(existsSync(dev), "docker-compose.dev.yml (opt-in dev overlay) is missing");
  assert.match(readFileSync(dev, "utf8"), /pnpm.*dev|next dev/, "the dev overlay should be the one that runs the dev server");
});

test("the default web service builds and serves production, not the dev server", () => {
  const block = serviceBlock("minutia-web");
  assert.doesNotMatch(block, /target:\s*deps/, "minutia-web must not build the deps-only stage by default");
  assert.doesNotMatch(block, /command:\s*\[?\s*["']?pnpm/, "minutia-web must not override the command to pnpm dev by default");
});

// Kong's declarative config is a template with ${ANON_KEY}/${SERVICE_ROLE_KEY}
// placeholders. Nothing but the container entrypoint substitutes them; if that is
// dropped, key-auth registers the literal placeholders and every API call (auth,
// REST, storage) fails with "Invalid authentication credentials".
test("kong substitutes the real API keys into its config at startup", () => {
  const block = serviceBlock("supabase-kong");
  assert.ok(block, "supabase-kong service is missing from docker-compose.yml");
  assert.match(block, /entrypoint:/, "supabase-kong needs an entrypoint that substitutes the key template");
  assert.match(block, /cat\s+\/home\/kong\/template\.yml/, "supabase-kong entrypoint must render the mounted key template");
  assert.match(block, /KONG_DECLARATIVE_CONFIG:\s*\/home\/kong\/kong\.yml/, "KONG_DECLARATIVE_CONFIG must point at the rendered file");
  assert.match(block, /ANON_KEY:\s*\$\{ANON_KEY\}/, "supabase-kong must receive ANON_KEY so the template can expand it");
  assert.match(block, /SERVICE_ROLE_KEY:\s*\$\{SERVICE_ROLE_KEY\}/, "supabase-kong must receive SERVICE_ROLE_KEY");
});

test("kong.yml is a placeholder template safe for shell substitution", () => {
  assert.match(kongTemplate, /\$\{ANON_KEY\}/, "kong.yml must keep the ${ANON_KEY} placeholder");
  assert.match(kongTemplate, /\$\{SERVICE_ROLE_KEY\}/, "kong.yml must keep the ${SERVICE_ROLE_KEY} placeholder");
  assert.ok(!kongTemplate.includes('"'), 'kong.yml must not contain double quotes (they break the eval "echo ..." substitution)');
});

// The self-host psql migrate path does not inherit Supabase's platform default
// privileges, so without them most tables are unreachable by the API roles (42501
// permission denied) and setup fails on a fresh box. They must be set BEFORE the
// migration loop (matching the platform) so each migration's own hardening REVOKE
// (profiles role columns, retro facilitator-token helpers) stays the final word. A
// blanket GRANT ... ON ALL after the loop silently re-opens those holes.
test("migrate script default-grants the API roles before migrations, preserving hardening", () => {
  assert.match(
    migrateScript,
    /ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role/,
    "must set default table privileges for the API roles",
  );
  assert.match(
    migrateScript,
    /ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role/,
    "must set default function privileges for the API roles",
  );
  assert.match(
    migrateScript,
    /minutia_migrations ENABLE ROW LEVEL SECURITY/,
    "the internal ledger must be default-deny",
  );
  const defaultPrivIdx = migrateScript.indexOf("ALTER DEFAULT PRIVILEGES");
  const loopIdx = migrateScript.indexOf("for f in /migrations");
  assert.ok(
    defaultPrivIdx !== -1 && loopIdx !== -1 && defaultPrivIdx < loopIdx,
    "ALTER DEFAULT PRIVILEGES must run BEFORE the migration loop, or hardening REVOKEs get clobbered",
  );
  assert.doesNotMatch(
    migrateScript,
    /GRANT (ALL|EXECUTE) ON ALL (TABLES|FUNCTIONS) IN SCHEMA public/,
    "must not blanket-GRANT ON ALL after migrations; it re-opens hardening REVOKEs (role escalation, token leak)",
  );
});

// The migration wiring above only proves `docker compose up` applies the app
// schema; it says nothing about whether the box a real self-hoster boots is
// actually reachable end to end. A CI job must build the .env, boot the
// production compose stack, wait for it, and drive the real cold-start
// journey (setup wizard -> first login) against it, or a regression here
// (e.g. Kong substitution, migrate wiring, /setup) ships invisibly since the
// e2e matrix uses `supabase start`, not this compose path.
test("cold-start gate is wired in CI", () => {
  assert.match(
    ciWorkflow,
    /generate-self-host-env\.mjs --force/,
    "CI must generate ./.env non-interactively before booting the compose stack",
  );
  assert.match(
    ciWorkflow,
    /docker compose up -d --build/,
    "CI must boot the self-host stack with a production build",
  );
  const envIdx = ciWorkflow.indexOf("generate-self-host-env.mjs --force");
  const upIdx = ciWorkflow.indexOf("docker compose up -d --build");
  assert.ok(
    envIdx !== -1 && upIdx !== -1 && envIdx < upIdx,
    "./.env must be generated before `docker compose up -d --build`, since NEXT_PUBLIC_* build args are baked into the image at build time",
  );

  assert.match(
    ciWorkflow,
    /wait-for-cold-start-stack\.sh/,
    "CI must wait for the booted stack to be ready via scripts/wait-for-cold-start-stack.sh before driving the journey",
  );

  assert.match(
    ciWorkflow,
    /playwright test --config=playwright\.cold-start\.config\.ts/,
    "CI must run the cold-start journey against playwright.cold-start.config.ts",
  );

  const logStep = ciWorkflow
    .split(/\n\s+- name:/)
    .find((step) => step.includes("docker compose logs"));
  assert.ok(
    logStep && /if:\s*(always|failure)\(\)/.test(logStep),
    "a step guarded by always() or failure() must capture `docker compose logs` so a cold-boot failure is diagnosable from the CI artifact",
  );
});
