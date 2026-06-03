import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mustExist = [
  "docker-compose.yml",
  ".env.example",
  "src/app/api/admin/invitations/route.ts",
  "src/lib/supabase/org-auth.ts",
  "scripts/generate-self-host-env.mjs",
  "scripts/run-self-host-migrations.sh",
  "supabase/migrations/20260526061638_multi_tenant_orgs.sql",
  "supabase/migrations/20260528071000_enforce_single_self_host_workspace.sql",
  "supabase/migrations/20260603021000_google_calendar_watch_channels.sql"
];

const mustNotExist = [
  "deploy/minutia/Caddyfile",
  "deploy/minutia/***.yml",
  "deploy/minutia/env.vps.example",
  "docs/***.md",
  "src/app/api/admin/organizations/route.ts",
  "src/app/org/[slug]/page.tsx",
  "scripts/***.sh",
  "supabase/migrations/20260527000000_***_gate.sql"
];

const bannedTextByFile = {
  ".env.example": [
    "***",
    "***"
  ],
  "src/app/(app)/settings/page.tsx": [
    "/api/admin/organizations",
    "Hosted organizations",
    "HostedOrgData"
  ],
  "src/components/minutia/app-sidebar.tsx": [
    "organizations.length > 1",
    "window.location.href = `/org/"
  ],
  "src/lib/supabase/admin-auth.ts": [
    "***",
    "***",
    "***"
  ],
  "playwright.config.ts": [
    "***"
  ],
  "e2e/regression/organization-rbac.spec.ts": [
    "/api/admin/organizations",
    "Hosted organizations",
    "***",
    "/org/${slug}",
    "selectOption(orgId)"
  ],
  "supabase/migrations/20260526061638_multi_tenant_orgs.sql": [
    "hosted_mode"
  ]
};

for (const path of mustExist) {
  assert.equal(existsSync(path), true, `${path} must remain for generic self-host`);
}

for (const path of mustNotExist) {
  assert.equal(existsSync(path), false, `${path} belongs in ***`);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(packageJson.scripts["***"], undefined, "*** belongs in ***");

const envExample = readFileSync(".env.example", "utf8");
const generatedEnvScript = readFileSync("scripts/generate-self-host-env.mjs", "utf8");
const dockerCompose = readFileSync("docker-compose.yml", "utf8");
const calendarWatchMigration = readFileSync(
  "supabase/migrations/20260603021000_google_calendar_watch_channels.sql",
  "utf8"
);

assert.match(envExample, /MINUTIA_SETUP_TOKEN=/, ".env.example must document the production setup token");
assert.match(generatedEnvScript, /MINUTIA_SETUP_TOKEN=/, "generated self-host env must include a setup token");
assert.match(envExample, /^ADDITIONAL_REDIRECT_URLS=.*\/accept-invite/m, ".env.example must allow invite redirects");
assert.match(generatedEnvScript, /ADDITIONAL_REDIRECT_URLS=\$\{inviteRedirectUrl\}/, "generated self-host env must allow invite redirects");
assert.match(generatedEnvScript, /GOOGLE_CALENDAR_WEBHOOK_URL=\$\{calendarWebhookUrl\}/, "generated self-host env must include the calendar webhook URL");
assert.match(dockerCompose, /GOTRUE_URI_ALLOW_LIST: .*\/accept-invite/, "docker compose must allow invite redirects by default");
assert.match(dockerCompose, /MINUTIA_SETUP_TOKEN=\$\{MINUTIA_SETUP_TOKEN/, "docker compose must pass setup token to the web app");
assert.match(dockerCompose, /NEXT_PUBLIC_SUPABASE_URL=\$\{NEXT_PUBLIC_SUPABASE_URL/, "docker compose must use the configured public Supabase URL");
assert.match(dockerCompose, /GOOGLE_CALENDAR_WEBHOOK_URL=\$\{GOOGLE_CALENDAR_WEBHOOK_URL/, "docker compose must pass the calendar webhook URL to the web app");
assert.match(dockerCompose, /\.\/supabase\/migrations:\/migrations:ro/, "docker compose must mount Supabase migrations");
assert.match(calendarWatchMigration, /CREATE TABLE IF NOT EXISTS public\.google_calendar_watch_channels/, "calendar watch channel table migration must remain");
assert.doesNotMatch(envExample, /***/, "Stripe configuration belongs in ***, not OSS setup docs");
assert.doesNotMatch(generatedEnvScript, /***/, "Stripe configuration belongs in ***, not OSS env generation");

for (const [path, bannedTerms] of Object.entries(bannedTextByFile)) {
  const content = readFileSync(path, "utf8");
  for (const term of bannedTerms) {
    assert.equal(
      content.includes(term),
      false,
(redacted)
    );
  }
}
