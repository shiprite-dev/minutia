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
  "supabase/migrations/20260528071000_enforce_single_self_host_workspace.sql"
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
