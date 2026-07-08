import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure URL helpers for node:test (repo verifier pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-authlinks-"));
const bundled = path.join(tempDir, "app-url.mjs");
await esbuild.build({
  entryPoints: ["src/lib/app-url.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { toPublicActionLink } = await import(pathToFileURL(bundled).href);

function withSupabaseUrl(value, fn) {
  const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  }
}

test("rewrites the internal GoTrue host to the public Supabase origin, preserving path + query", () => {
  withSupabaseUrl("https://app.getminutia.com", () => {
    const internal =
      "http://supabase-kong/auth/v1/verify?token=abc123&type=recovery&redirect_to=https://app.getminutia.com/reset-password";
    assert.equal(
      toPublicActionLink(internal),
      "https://app.getminutia.com/auth/v1/verify?token=abc123&type=recovery&redirect_to=https://app.getminutia.com/reset-password"
    );
  });
});

test("rewrites an internal host:port too", () => {
  withSupabaseUrl("https://app.getminutia.com", () => {
    const internal = "http://supabase-kong:8000/auth/v1/verify?token=x&type=invite";
    assert.equal(
      toPublicActionLink(internal),
      "https://app.getminutia.com/auth/v1/verify?token=x&type=invite"
    );
  });
});

test("is idempotent when the link already targets the public Supabase base (E2E: same host)", () => {
  withSupabaseUrl("http://127.0.0.1:54321", () => {
    const already = "http://127.0.0.1:54321/auth/v1/verify?token=zzz&type=recovery";
    assert.equal(toPublicActionLink(already), already);
  });
});

test("origin comes only from NEXT_PUBLIC_SUPABASE_URL, never the link's own host", () => {
  withSupabaseUrl("https://staging.getminutia.com", () => {
    const internal = "http://supabase-kong/auth/v1/verify?token=q";
    assert.equal(
      toPublicActionLink(internal),
      "https://staging.getminutia.com/auth/v1/verify?token=q"
    );
  });
});

test("preserves URL-encoded query values (redirect_to) byte-for-byte", () => {
  withSupabaseUrl("https://app.getminutia.com", () => {
    const internal =
      "http://supabase-kong/auth/v1/verify?redirect_to=https%3A%2F%2Fapp.getminutia.com%2Faccept-invite&token=t";
    const out = toPublicActionLink(internal);
    assert.ok(out.startsWith("https://app.getminutia.com/auth/v1/verify?"));
    assert.ok(out.includes("redirect_to=https%3A%2F%2Fapp.getminutia.com%2Faccept-invite"));
    assert.ok(out.includes("token=t"));
  });
});

test("returns the link unchanged when NEXT_PUBLIC_SUPABASE_URL is unset", () => {
  withSupabaseUrl(undefined, () => {
    const link = "http://supabase-kong/auth/v1/verify?token=t";
    assert.equal(toPublicActionLink(link), link);
  });
});
