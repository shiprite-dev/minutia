import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure invite-delivery logic so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-invitations-"));
const bundled = path.join(tempDir, "invitations.mjs");
await esbuild.build({
  entryPoints: ["src/lib/invitations.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { inviteDelivery } = await import(pathToFileURL(bundled).href);

const ACCEPT_URL = "https://instance.test/accept-invite#token=abc";

test("email ok -> delivery email, no link surfaced", () => {
  const result = inviteDelivery({ emailError: null, acceptUrl: ACCEPT_URL });
  assert.deepEqual(result, { invited: true, delivery: "email" });
});

test("email throws with a fallback link -> delivery link + acceptUrl passthrough", () => {
  const result = inviteDelivery({
    emailError: new Error("Email is not configured."),
    acceptUrl: ACCEPT_URL,
  });
  assert.deepEqual(result, {
    invited: true,
    delivery: "link",
    acceptUrl: ACCEPT_URL,
  });
});

test("email throws without a fallback link -> explicit error, not a silent success", () => {
  const result = inviteDelivery({
    emailError: new Error("Email is not configured."),
    acceptUrl: null,
  });
  assert.equal(result.invited, false);
  assert.equal(result.error, "Email is not configured.");
});

test("non-Error email failures still surface a string message", () => {
  const result = inviteDelivery({ emailError: "smtp exploded", acceptUrl: undefined });
  assert.equal(result.invited, false);
  assert.equal(result.error, "smtp exploded");
});

test("an empty-string acceptUrl is treated as no link", () => {
  const result = inviteDelivery({ emailError: new Error("boom"), acceptUrl: "" });
  assert.equal(result.invited, false);
  assert.equal(result.error, "boom");
});
