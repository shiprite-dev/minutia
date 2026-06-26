import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-upgrade-ticket-"));
const bundled = path.join(tempDir, "upgrade-ticket.mjs");
await esbuild.build({
  entryPoints: ["src/lib/billing/upgrade-ticket.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { mintUpgradeTicket } = await import(pathToFileURL(bundled).href);

test("mints a verifiable token with the agreed shape", () => {
  const token = mintUpgradeTicket({
    userId: "u1",
    organizationId: "o1",
    organizationName: "Acme",
    email: "a@b.com",
    secret: "s",
    now: new Date(1_000_000_000_000),
  });
  const [body, sig] = token.split(".");
  assert.equal(createHmac("sha256", "s").update(body).digest("base64url"), sig);
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  assert.equal(payload.u, "u1");
  assert.equal(payload.o, "o1");
  assert.equal(payload.n, "Acme");
  assert.equal(payload.e, "a@b.com");
  assert.equal(payload.exp, 1_000_000_000 + 600);
});

test("uses custom ttlSeconds when provided", () => {
  const token = mintUpgradeTicket({
    userId: "u2",
    organizationId: "o2",
    organizationName: "Beta",
    email: "b@c.com",
    secret: "secret",
    ttlSeconds: 300,
    now: new Date(2_000_000_000_000),
  });
  const [body] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  assert.equal(payload.exp, 2_000_000_000 + 300);
});

test("different secrets produce different signatures", () => {
  const args = { userId: "u", organizationId: "o", organizationName: "N", email: "e@f.com", now: new Date(0) };
  const t1 = mintUpgradeTicket({ ...args, secret: "s1" });
  const t2 = mintUpgradeTicket({ ...args, secret: "s2" });
  assert.notEqual(t1.split(".")[1], t2.split(".")[1]);
});

test("token contains no pricing or provider language", () => {
  const token = mintUpgradeTicket({
    userId: "u",
    organizationId: "o",
    organizationName: "Test",
    email: "t@t.com",
    secret: "x",
  });
  assert.doesNotMatch(token, /stripe|pro\b|plan|price|\$/i);
});
