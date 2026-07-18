import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-email-layout-"));
const bundled = path.join(tempDir, "email-layout.mjs");
await esbuild.build({
  entryPoints: ["src/lib/email-layout.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { renderEmailLayout, MINUTIA_EMAIL_BRANDING, EMAIL_ACCENT } = await import(
  pathToFileURL(bundled).href
);

test("renders a complete html document with color-scheme and dark block", () => {
  const html = renderEmailLayout({
    preheader: "A quick pre-meeting brief",
    heading: "Weekly Sync",
    intro: "Here is what is open.",
    bodyHtml: "<p>body</p>",
    cta: { label: "See the live log", href: "https://minutia.example/share/abc?you=a%40b.com" },
    footerUrl: "https://minutia.example",
  });

  assert.ok(/^<!doctype html>/i.test(html), "starts with doctype");
  assert.ok(html.includes('name="color-scheme"'), "declares color-scheme");
  assert.ok(html.includes("prefers-color-scheme: dark"), "carries dark block");
  assert.ok(html.includes("Georgia"), "wordmark uses a serif stack");
  assert.ok(html.includes(EMAIL_ACCENT), "uses the app accent hex");
  assert.ok(html.includes("<p>body</p>"), "embeds trusted body html verbatim");
});

test("hidden preheader carries its text", () => {
  const html = renderEmailLayout({
    preheader: "Peek text here",
    heading: "H",
    bodyHtml: "",
  });
  assert.ok(html.includes("display:none"), "preheader is hidden");
  assert.ok(html.includes("Peek text here"), "preheader text present");
});

test("cta button carries the exact href and label", () => {
  const href = "https://minutia.example/share/tok?you=alice%40example.com";
  const html = renderEmailLayout({
    preheader: "p",
    heading: "H",
    bodyHtml: "",
    cta: { label: "See the live log", href },
  });
  assert.ok(html.includes(`href="${href}"`), "href preserved");
  assert.ok(html.includes("See the live log"), "label present");
});

test("footer carries the non-removable branding, linked to the instance", () => {
  const html = renderEmailLayout({
    preheader: "p",
    heading: "H",
    bodyHtml: "",
    footerUrl: "https://minutia.example",
  });
  assert.ok(html.includes(MINUTIA_EMAIL_BRANDING), "branding present");
  assert.ok(MINUTIA_EMAIL_BRANDING.toLowerCase().includes("minutia"));
  assert.ok(
    html.includes('href="https://minutia.example"'),
    "branding links to the instance url"
  );
});

test("escapes adversarial heading, intro, preheader, cta and footer", () => {
  const nasty = `"><script>alert(1)</script>`;
  const html = renderEmailLayout({
    preheader: nasty,
    heading: nasty,
    intro: nasty,
    bodyHtml: "",
    cta: { label: nasty, href: `https://x/?a=1&b=2">${nasty}` },
    footerNote: nasty,
    footerUrl: `https://x/?q=1">${nasty}`,
  });
  assert.ok(!html.includes("<script>alert(1)</script>"), "no raw script tag");
  assert.ok(html.includes("&lt;script&gt;"), "script tag escaped");
  assert.ok(html.includes("&quot;"), "attribute-breaking quote escaped");
});
