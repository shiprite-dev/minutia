import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mustExist = [
  "docker-compose.yml",
  ".env.example",
  "scripts/generate-self-host-env.mjs",
  "scripts/run-self-host-migrations.sh"
];

const mustNotExist = [
  "deploy/minutia/Caddyfile",
  "deploy/minutia/docker-compose.vps.yml",
  "deploy/minutia/env.vps.example",
  "docs/DEPLOY_SELF_HOST_VPS.md",
  "scripts/deploy-minutia-vps.sh"
];

for (const path of mustExist) {
  assert.equal(existsSync(path), true, `${path} must remain for generic self-host`);
}

for (const path of mustNotExist) {
  assert.equal(existsSync(path), false, `${path} belongs in minutia-ops`);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(packageJson.scripts["deploy:vps"], undefined, "deploy:vps belongs in minutia-ops");
