import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-ai-form-"));
const bundled = path.join(tempDir, "ai-form.mjs");

await esbuild.build({
  entryPoints: ["src/lib/ai/form.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});

const { aiFormFields } = await import(pathToFileURL(bundled).href);

test("openai-compatible includes baseUrl, provider, apiKey, model", () => {
  const fields = aiFormFields("openai-compatible");
  assert.ok(fields.includes("baseUrl"), "should include baseUrl");
  assert.ok(fields.includes("provider"), "should include provider");
  assert.ok(fields.includes("apiKey"), "should include apiKey");
  assert.ok(fields.includes("model"), "should include model");
});

test("anthropic does NOT include baseUrl", () => {
  const fields = aiFormFields("anthropic");
  assert.ok(!fields.includes("baseUrl"), "should not include baseUrl");
});

test("anthropic includes provider, apiKey, model", () => {
  const fields = aiFormFields("anthropic");
  assert.ok(fields.includes("provider"), "should include provider");
  assert.ok(fields.includes("apiKey"), "should include apiKey");
  assert.ok(fields.includes("model"), "should include model");
});
