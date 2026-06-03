import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, test } from "node:test";

const root = resolve(".");
const verifyScript = resolve("scripts/verify-runtime-config.mjs");
const generateScript = resolve("scripts/generate-self-host-env.mjs");
const tempDir = mkdtempSync(join(tmpdir(), "minutia-runtime-config-"));

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function envFile(contents) {
  const file = join(tempDir, `${randomUUID()}.env`);
  writeFileSync(file, contents.trimStart());
  return file;
}

function runVerify(contents) {
  return spawnSync(process.execPath, [verifyScript, "--env-file", envFile(contents)], {
    cwd: root,
    encoding: "utf8",
  });
}

function expectPass(result) {
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
}

function expectFail(result, message) {
  assert.notEqual(result.status, 0, "expected runtime config verification to fail");
  assert.match(`${result.stderr}\n${result.stdout}`, message);
}

describe("runtime configuration verification", () => {
  test("accepts local development HTTP Supabase URLs", () => {
    expectPass(runVerify(`
SITE_URL=http://localhost:3000
PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
GOOGLE_CALENDAR_WEBHOOK_URL=
`));
  });

  test("rejects a public HTTP Supabase URL that would break browser login", () => {
    expectFail(
      runVerify(`
SITE_URL=https://app.example.com
PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_SUPABASE_URL=http://203.0.113.10
GOOGLE_CALENDAR_WEBHOOK_URL=https://app.example.com/api/calendar/webhook
`),
      /NEXT_PUBLIC_SUPABASE_URL must use HTTPS for non-local hosts/
    );
  });

  test("rejects Supabase public URL drift when PUBLIC_API_URL is configured", () => {
    expectFail(
      runVerify(`
SITE_URL=https://app.example.com
PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_SUPABASE_URL=https://wrong.example.com
GOOGLE_CALENDAR_WEBHOOK_URL=https://app.example.com/api/calendar/webhook
`),
      /NEXT_PUBLIC_SUPABASE_URL must match PUBLIC_API_URL/
    );
  });

  test("rejects Google Calendar credentials without a callable webhook URL", () => {
    expectFail(
      runVerify(`
SITE_URL=https://app.example.com
PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_SUPABASE_URL=https://api.example.com
GOOGLE_CLIENT_ID=client-id
GOOGLE_CLIENT_SECRET=client-secret
GOOGLE_CALENDAR_WEBHOOK_URL=
`),
      /GOOGLE_CALENDAR_WEBHOOK_URL is required when Google Calendar credentials are configured/
    );
  });

  test("rejects a Google Calendar webhook URL with the wrong shape", () => {
    expectFail(
      runVerify(`
SITE_URL=https://app.example.com
PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_SUPABASE_URL=https://api.example.com
GOOGLE_CALENDAR_WEBHOOK_URL=http://app.example.com/api/calendar/hooks
`),
      /GOOGLE_CALENDAR_WEBHOOK_URL must use HTTPS/
    );
  });

  test("rejects a Google Calendar webhook URL with the wrong path", () => {
    expectFail(
      runVerify(`
SITE_URL=https://app.example.com
PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_SUPABASE_URL=https://api.example.com
GOOGLE_CALENDAR_WEBHOOK_URL=https://app.example.com/api/calendar/hooks
`),
      /GOOGLE_CALENDAR_WEBHOOK_URL path must be \/api\/calendar\/webhook/
    );
  });

  test("generated production env passes the runtime guard", () => {
    const out = join(tempDir, "generated.env");
    const generate = spawnSync(
      process.execPath,
      [
        generateScript,
        "--out",
        out,
        "--force",
        "--site-url",
        "https://app.example.com",
        "--api-url",
        "https://api.example.com",
      ],
      { cwd: root, encoding: "utf8" }
    );
    expectPass(generate);

    const generatedEnv = readFileSync(out, "utf8");
    assert.match(
      generatedEnv,
      /^GOOGLE_CALENDAR_WEBHOOK_URL=https:\/\/app\.example\.com\/api\/calendar\/webhook$/m
    );

    const verify = spawnSync(process.execPath, [verifyScript, "--env-file", out], {
      cwd: root,
      encoding: "utf8",
    });
    expectPass(verify);
  });
});
