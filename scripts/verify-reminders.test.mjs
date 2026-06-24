import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// Bundle the pure reminders logic so node:test can exercise it (repo pattern).
const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-reminders-"));
const bundled = path.join(tempDir, "reminders.mjs");
await esbuild.build({
  entryPoints: ["src/lib/reminders/index.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const {
  MINUTIA_BRANDING,
  gatherOwnerReminders,
  resolveReminderChannel,
  formatReminderDigest,
  formatOwnerEmail,
  buildSlackMessage,
  buildWebhookPayload,
} = await import(pathToFileURL(bundled).href);

const ISSUES = [
  { id: "i1", issue_number: 1, series_id: "s1", title: "Ship CI", status: "open", priority: "high", owner_user_id: "u1", owner_name: "Sam" },
  { id: "i2", issue_number: 2, series_id: "s1", title: "Write docs", status: "in_progress", priority: "critical", owner_user_id: "u1", owner_name: "Sam" },
  { id: "i3", issue_number: 3, series_id: "s1", title: "Pick vendor", status: "open", priority: "low", owner_user_id: "u2", owner_name: "Jo" },
  { id: "i4", issue_number: 4, series_id: "s1", title: "External owner task", status: "open", priority: "medium", owner_user_id: null, owner_name: "Contractor" },
  { id: "i5", issue_number: 5, series_id: "s1", title: "Nobody owns this", status: "open", priority: "medium", owner_user_id: null, owner_name: null },
  { id: "i6", issue_number: 6, series_id: "s1", title: "Already done", status: "resolved", priority: "high", owner_user_id: "u1", owner_name: "Sam" },
  { id: "i7", issue_number: 7, series_id: "s1", title: "Dropped", status: "dropped", priority: "high", owner_user_id: "u2", owner_name: "Jo" },
];

const PROFILES = {
  u1: { email: "sam@example.com", name: "Sam Rivera" },
  u2: { email: "jo@example.com", name: "Jo Tan" },
};

const CTX = { seriesName: "Weekly Sync", appUrl: "https://minutia.example/series/s1" };

test("gather groups open issues by owner, resolves emails, excludes resolved/dropped", () => {
  const owners = gatherOwnerReminders(ISSUES, PROFILES);
  // u1(2 open) + u2(1 open) + Contractor(free-text, 1) + Unassigned(1) = 4 groups
  assert.equal(owners.length, 4);

  const sam = owners.find((o) => o.ownerUserId === "u1");
  assert.ok(sam, "Sam group exists");
  assert.equal(sam.ownerEmail, "sam@example.com");
  assert.equal(sam.issues.length, 2, "only open/in_progress issues, resolved excluded");
  // sorted by priority desc: critical before high
  assert.equal(sam.issues[0].title, "Write docs");

  const jo = owners.find((o) => o.ownerUserId === "u2");
  assert.equal(jo.issues.length, 1, "dropped issue excluded");

  const contractor = owners.find((o) => o.ownerName === "Contractor");
  assert.equal(contractor.ownerEmail, null, "free-text owner has no email");

  const unassigned = owners.find((o) => o.ownerUserId === null && !o.ownerName);
  assert.ok(unassigned, "unassigned group exists");
  assert.equal(unassigned.issues.length, 1);
});

test("gather returns empty array when no open issues", () => {
  const closed = ISSUES.filter((i) => i.status === "resolved" || i.status === "dropped");
  assert.deepEqual(gatherOwnerReminders(closed, PROFILES), []);
});

test("channel cascade resolves email > slack > webhook > clipboard", () => {
  assert.equal(resolveReminderChannel({ smtpConfigured: true }), "email");
  assert.equal(resolveReminderChannel({ resendConfigured: true }), "email");
  assert.equal(resolveReminderChannel({ slackWebhookUrl: "https://hooks.slack.com/x" }), "slack");
  assert.equal(resolveReminderChannel({ reminderWebhookUrl: "https://hook.site/x" }), "webhook");
  assert.equal(resolveReminderChannel({}), "clipboard");
  // email wins even if everything is set
  assert.equal(
    resolveReminderChannel({ smtpConfigured: true, slackWebhookUrl: "x", reminderWebhookUrl: "y" }),
    "email"
  );
});

test("digest contains every issue title and the Sent via Minutia branding", () => {
  const owners = gatherOwnerReminders(ISSUES, PROFILES);
  const digest = formatReminderDigest(owners, CTX);

  for (const fmt of ["markdown", "text", "html"]) {
    assert.ok(digest[fmt].includes(MINUTIA_BRANDING), `${fmt} carries branding`);
    assert.ok(digest[fmt].includes(CTX.appUrl), `${fmt} carries instance url`);
    assert.ok(digest[fmt].includes("Ship CI"), `${fmt} lists an issue title`);
    assert.ok(digest[fmt].includes("Weekly Sync"), `${fmt} names the series`);
  }
  assert.ok(MINUTIA_BRANDING.toLowerCase().includes("minutia"));
  assert.ok(digest.subject.includes("Weekly Sync"));
});

test("per-owner email targets one owner and carries branding", () => {
  const owners = gatherOwnerReminders(ISSUES, PROFILES);
  const sam = owners.find((o) => o.ownerUserId === "u1");
  const email = formatOwnerEmail(sam, CTX);
  assert.ok(email.subject.length > 0);
  assert.ok(email.html.includes("Write docs"));
  assert.ok(email.html.includes(MINUTIA_BRANDING));
  assert.ok(email.text.includes(MINUTIA_BRANDING));
  // does not leak the other owner's items
  assert.ok(!email.html.includes("Pick vendor"));
});

test("slack message has blocks and branding", () => {
  const owners = gatherOwnerReminders(ISSUES, PROFILES);
  const msg = buildSlackMessage(owners, CTX);
  assert.ok(Array.isArray(msg.blocks) && msg.blocks.length > 0);
  assert.ok(msg.text.includes(MINUTIA_BRANDING));
});

test("webhook payload is structured and branded", () => {
  const owners = gatherOwnerReminders(ISSUES, PROFILES);
  const payload = buildWebhookPayload(owners, CTX);
  assert.equal(payload.series, "Weekly Sync");
  assert.equal(payload.branding, MINUTIA_BRANDING);
  assert.equal(payload.url, CTX.appUrl);
  assert.ok(Array.isArray(payload.owners) && payload.owners.length === 4);
  assert.ok(payload.owners[0].issues.length >= 1);
});

test("html output is escaped against injection", () => {
  const nasty = [
    { id: "x1", issue_number: 9, series_id: "s1", title: "<script>alert(1)</script>", status: "open", priority: "high", owner_user_id: "u1", owner_name: "Sam" },
  ];
  const owners = gatherOwnerReminders(nasty, PROFILES);
  const digest = formatReminderDigest(owners, CTX);
  assert.ok(!digest.html.includes("<script>alert(1)</script>"), "raw script tag must be escaped");
  assert.ok(digest.html.includes("&lt;script&gt;"));
});
