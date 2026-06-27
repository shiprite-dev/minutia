import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-admin-config-capabilities-"));
const bundled = path.join(tempDir, "config-capabilities.mjs");
await esbuild.build({
  entryPoints: ["src/lib/admin/config-capabilities.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { rejectedConfigKeys } = await import(pathToFileURL(bundled).href);

const selfHostCaps = {
  instanceIdentity: true,
  email: true,
  ai: true,
  slackWebhook: true,
  reminderWebhook: true,
  retroToggle: true,
  promptLinks: true,
  users: true,
  upgradePrompt: true,
};

const cloudCaps = {
  instanceIdentity: true,
  email: false,
  ai: false,
  slackWebhook: true,
  reminderWebhook: false,
  retroToggle: false,
  promptLinks: false,
  users: true,
  upgradePrompt: true,
};

test("self-host caps: no keys are rejected", () => {
  const result = rejectedConfigKeys(
    ["smtp_host", "ai_api_key", "slack_webhook_url", "instance_name"],
    selfHostCaps
  );
  assert.deepEqual(result, []);
});

test("cloud caps: email/ai/reminderWebhook/retroToggle/promptLinks keys are rejected", () => {
  const result = rejectedConfigKeys(
    [
      "smtp_host",
      "ai_api_key",
      "reminder_webhook_url",
      "ai_notice_url",
      "retro_enabled",
      "slack_webhook_url",
      "instance_name",
    ],
    cloudCaps
  );
  // Order-insensitive: compare as sets
  assert.deepEqual(
    new Set(result),
    new Set(["smtp_host", "ai_api_key", "reminder_webhook_url", "ai_notice_url", "retro_enabled"])
  );
  assert.equal(result.includes("slack_webhook_url"), false, "slack_webhook_url must not be rejected");
  assert.equal(result.includes("instance_name"), false, "instance_name must not be rejected");
});

test("unknown key is not rejected on cloud caps", () => {
  const result = rejectedConfigKeys(["some_future_key"], cloudCaps);
  assert.deepEqual(result, []);
});

test("cloud caps: all smtp keys are rejected", () => {
  const smtpKeys = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"];
  const result = rejectedConfigKeys(smtpKeys, cloudCaps);
  assert.deepEqual(new Set(result), new Set(smtpKeys));
});

test("cloud caps: all ai keys are rejected", () => {
  const aiKeys = ["ai_provider", "ai_base_url", "ai_api_key", "ai_model"];
  const result = rejectedConfigKeys(aiKeys, cloudCaps);
  assert.deepEqual(new Set(result), new Set(aiKeys));
});

test("cloud caps: capacity_notice_url is rejected (promptLinks)", () => {
  const result = rejectedConfigKeys(["capacity_notice_url"], cloudCaps);
  assert.deepEqual(result, ["capacity_notice_url"]);
});
