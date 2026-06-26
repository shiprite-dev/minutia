import { existsSync, readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

// Self-host integrity check.
// Verifies the generic, provider-neutral self-host surface stays intact:
// required files are present and key self-host wiring is wired up.
// This check only asserts what SHOULD exist; it intentionally does not
// enumerate or describe anything outside this repository.

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

for (const path of mustExist) {
  assert.equal(existsSync(path), true, `${path} must remain for generic self-host`);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(typeof packageJson.scripts.build, "string", "package.json must define a build script");

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

// The OSS landing page must not disclose the hosted pricing model. Prices,
// tiers, and freemium framing belong on the separate minutia-landing site, not
// in the self-host repo where they are shown to operators who pay nothing.
const landingPage = readFileSync("src/app/page.tsx", "utf8");
const forbiddenLandingDisclosures = [
  [/\$\d/, "a price amount (e.g. $5)"],
  [/\/\s*month\b/i, "a per-month subscription cadence"],
  [/per\s+(?:seat|month|year)/i, "a per-seat/month/year price"],
  [/free forever/i, "'free forever' freemium framing"],
  [/pricing/i, "a pricing section"],
  [/\(Pro\)/, "a '(Pro)' tier label"],
];
for (const [pattern, label] of forbiddenLandingDisclosures) {
  assert.ok(
    !pattern.test(landingPage),
    `OSS landing page (src/app/page.tsx) must not disclose ${label}; move it to minutia-landing`
  );
}

// The AI-unavailable upsell seam must stay provider-neutral: no pricing, tiers,
// or freemium framing in the OSS source. Hosted builds drive the CTA purely from
// instance_config.ai_notice_url. This keeps the open-core boundary intact.
const aiNoticeSeamFiles = [
  "src/components/minutia/ai-unavailable-notice.tsx",
  "src/components/minutia/upgrade-confirmation.tsx",
  "src/lib/ai/notice.ts",
  "src/lib/billing/upgrade-poll-state.ts",
  "src/app/api/ai-notice/route.ts",
  "src/lib/hooks/use-ai-access.ts",
];
const forbiddenSeamDisclosures = [
  [/\$\d/, "a price amount"],
  [/\bpricing\b/i, "pricing language"],
  [/per\s+(?:seat|month|year)/i, "a per-seat/month/year price"],
  [/\/\s*month\b/i, "a per-month cadence"],
  [/free forever/i, "'free forever' framing"],
  [/\bteams?\s+plan\b/i, "a teams plan label"],
  [/\bpro\s+plan\b/i, "a pro plan label"],
];
for (const file of aiNoticeSeamFiles) {
  const contents = readFileSync(file, "utf8");
  for (const [pattern, label] of forbiddenSeamDisclosures) {
    assert.ok(
      !pattern.test(contents),
      `${file} must not disclose ${label}; the upsell CTA comes from instance_config, not OSS code`
    );
  }
}

// Every hardcoded GitHub repo link must point at the canonical org. A wrong
// slug 404s on the login footer and the public guest-share footer, which are
// the repo's primary star-conversion surfaces.
const CANONICAL_REPO = "shiprite-dev/minutia";
const repoRef = /github\.com\/([\w-]+)\/minutia\b/gi;
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}
for (const file of [...sourceFiles("src"), ...sourceFiles("e2e")]) {
  for (const m of readFileSync(file, "utf8").matchAll(repoRef)) {
    assert.equal(
      `${m[1]}/minutia`,
      CANONICAL_REPO,
      `${file} links github.com/${m[1]}/minutia; canonical repo is github.com/${CANONICAL_REPO}`
    );
  }
}

console.log("OSS self-host integrity verified");
