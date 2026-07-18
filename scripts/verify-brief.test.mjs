import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-brief-"));
const bundled = path.join(tempDir, "brief.mjs");
await esbuild.build({
  entryPoints: ["src/lib/brief/index.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { buildSeriesBrief, ownerMatchesRecipient } = await import(
  pathToFileURL(bundled).href
);

function issue(overrides) {
  return {
    id: overrides.id,
    issue_number: 1,
    raised_in_meeting_id: "m1",
    series_id: "s1",
    title: overrides.title ?? "An item",
    description: null,
    category: "action",
    status: "open",
    priority: overrides.priority ?? "medium",
    sort_order: 0,
    owner_user_id: overrides.owner_user_id ?? null,
    owner_name: overrides.owner_name ?? null,
    ownerEmail: overrides.ownerEmail ?? null,
    source: "manual",
    due_date: overrides.due_date ?? null,
    resolved_in_meeting_id: null,
    created_at: overrides.created_at ?? "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  };
}

const SERIES = { name: "Platform Team Standup", cadence: "weekly" };
const NEXT = { title: "Standup #5", date: "2026-04-22" };
const GUEST_URL = "https://minutia.example/share/tok";

test("matcher: email equality and name-token heuristic, no false positives", () => {
  assert.equal(
    ownerMatchesRecipient("alice@example.com", { ownerName: null, ownerEmail: "alice@example.com" }),
    true
  );
  assert.equal(
    ownerMatchesRecipient("alice@example.com", { ownerName: "Alice", ownerEmail: null }),
    true
  );
  assert.equal(
    ownerMatchesRecipient("alice.smith@example.com", { ownerName: "Alice Smith" }),
    true
  );
  // "Al" must not match "alice"
  assert.equal(ownerMatchesRecipient("alice@example.com", { ownerName: "Al" }), false);
  // a known owner email is definitive: no name fallback for a different recipient
  assert.equal(
    ownerMatchesRecipient("bob.smith@example.com", {
      ownerName: "Bob",
      ownerEmail: "bob@example.com",
    }),
    false
  );
  // unrelated owner
  assert.equal(ownerMatchesRecipient("alice@example.com", { ownerName: "Test User" }), false);
  // not an email
  assert.equal(ownerMatchesRecipient("alice", { ownerName: "Alice" }), false);
});

test("per-recipient split: your open items vs also on the log", () => {
  const openIssues = [
    issue({ id: "a", title: "Alice item", owner_name: "Alice", priority: "high" }),
    issue({ id: "b", title: "Bob item", owner_name: "Bob", priority: "critical" }),
    issue({ id: "c", title: "Orphan item", owner_name: "Carol", priority: "low" }),
  ];
  const [alice] = buildSeriesBrief({
    series: SERIES,
    nextMeeting: NEXT,
    openIssues,
    recipients: ["alice@example.com"],
    guestUrl: GUEST_URL,
  });

  assert.ok(alice.html.includes("Your open items"));
  assert.ok(alice.html.includes("Alice item"), "alice sees her own item");
  // her own item is not duplicated into "Also on the log"
  const alsoIdx = alice.html.indexOf("Also on the log");
  assert.ok(alice.html.slice(alsoIdx).includes("Bob item"), "others surface under also");
  assert.ok(!alice.html.slice(alsoIdx).includes("Alice item"), "own item excluded from also");
  assert.ok(alice.text.includes("Alice item"));
});

test("subject carries series and meeting date; cta deep-links with ?you=", () => {
  const [brief] = buildSeriesBrief({
    series: SERIES,
    nextMeeting: NEXT,
    openIssues: [],
    recipients: ["alice@example.com"],
    guestUrl: GUEST_URL,
  });
  assert.equal(brief.subject, "Brief: Platform Team Standup on Wed, Apr 22, 2026");
  assert.ok(
    brief.html.includes(`${GUEST_URL}?you=${encodeURIComponent("alice@example.com")}`),
    "cta deep-links with encoded recipient"
  );
});

test("empty-owner recipient gets an encouraging empty state", () => {
  const openIssues = [issue({ id: "b", title: "Bob item", owner_name: "Bob" })];
  const [alice] = buildSeriesBrief({
    series: SERIES,
    nextMeeting: NEXT,
    openIssues,
    recipients: ["alice@example.com"],
    guestUrl: GUEST_URL,
  });
  const alsoIdx = alice.html.indexOf("Also on the log");
  assert.ok(alice.html.slice(0, alsoIdx).includes("no open items"), "empty your-items note");
});

test("zero recipients yields zero briefs", () => {
  const briefs = buildSeriesBrief({
    series: SERIES,
    nextMeeting: NEXT,
    openIssues: [issue({ id: "a", owner_name: "Alice" })],
    recipients: [],
    guestUrl: GUEST_URL,
  });
  assert.deepEqual(briefs, []);
});

test("no next meeting: subject omits the date", () => {
  const [brief] = buildSeriesBrief({
    series: SERIES,
    nextMeeting: null,
    openIssues: [],
    recipients: ["alice@example.com"],
    guestUrl: GUEST_URL,
  });
  assert.equal(brief.subject, "Brief: Platform Team Standup");
});

test("html output is escaped against injection", () => {
  const openIssues = [
    issue({ id: "x", title: "<script>alert(1)</script>", owner_name: "Alice" }),
  ];
  const [brief] = buildSeriesBrief({
    series: { name: "<b>Series</b>", cadence: "weekly" },
    nextMeeting: NEXT,
    openIssues,
    recipients: ["alice@example.com"],
    guestUrl: GUEST_URL,
  });
  assert.ok(!brief.html.includes("<script>alert(1)</script>"), "issue title escaped");
  assert.ok(!brief.html.includes("<b>Series</b>"), "series name escaped");
  assert.ok(brief.html.includes("&lt;script&gt;"));
});
