import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-review-queue-"));
const bundled = path.join(tempDir, "review-queue.mjs");
await esbuild.build({
  entryPoints: ["src/lib/companion/review-queue.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { buildReviewQueue } = await import(pathToFileURL(bundled).href);

const now = new Date("2026-11-21T12:00:00Z");
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
const priya = { id: "priya-id", name: "Priya Shah" };

const row = (over) => ({
  id: "s1",
  type: "new_item",
  category: "action",
  title: "Send the budget",
  owner_name: "Priya",
  due_date: "2026-11-25",
  confidence: 0.92,
  related_issue_number: null,
  suggested_status: null,
  ...over,
});

const meeting = (over = {}) => ({
  meeting_id: "m1",
  series_id: "series1",
  series_name: "Weekly sync",
  ended_at: daysAgo(1),
  transcription_status: "completed",
  suggestions_status: "ready",
  suggestions_reason: null,
  status_at: daysAgo(1),
  reviewer: true,
  suggestions: [row()],
  members: [priya],
  issueTitles: {},
  ...over,
});

const list = (meetings) =>
  buildReviewQueue({ me: "me-id", now, meetings, mode: "list" });

test("an action item shows on the Mac with the owner matched to the series member and the exact fields", () => {
  const { me, meetings } = list([meeting()]);
  assert.equal(me, "me-id");
  assert.deepEqual(meetings[0].rows, [
    {
      id: "s1",
      type: "new_item",
      category: "action",
      title: "Send the budget",
      owner_name: "Priya",
      owner_user_id: "priya-id",
      due_date: "2026-11-25",
      confidence: 0.92,
      related_issue_number: null,
      related_issue_title: null,
      suggested_status: null,
    },
  ]);
  assert.deepEqual(meetings[0].members, [{ id: "priya-id", name: "Priya Shah" }]);
  assert.equal(meetings[0].web_only_count, 0);
});

test("a first name shared by two members leaves the owner unassigned", () => {
  const { meetings } = list([
    meeting({
      suggestions: [row({ owner_name: "Alex" })],
      members: [
        { id: "alex-kim", name: "Alex Kim" },
        { id: "alex-roe", name: "Alex Roe" },
      ],
    }),
  ]);
  assert.equal(meetings[0].rows[0].owner_user_id, null);
  assert.equal(meetings[0].rows[0].owner_name, "Alex");
});

test("decisions, info and duplicate warnings stay on the web and are counted", () => {
  const { meetings } = list([
    meeting({
      suggestions: [
        row({ id: "a", title: "Ship it" }),
        row({ id: "b", category: "decision", title: "Use Postgres" }),
        row({ id: "c", category: "info", title: "FYI" }),
        row({ id: "d", type: "duplicate_warning", title: "Already tracked" }),
        row({ id: "e", category: "risk", title: "Vendor slips" }),
        row({ id: "f", category: "blocker", title: "No access" }),
      ],
    }),
  ]);
  assert.deepEqual(
    meetings[0].rows.map((r) => r.title),
    ["Ship it", "Vendor slips", "No access"],
  );
  assert.equal(meetings[0].web_only_count, 3);
});

test("an update to an existing item shows with that item's title and target status", () => {
  const { meetings } = list([
    meeting({
      suggestions: [
        row({
          type: "status_update",
          category: "action",
          related_issue_number: 7,
          suggested_status: "resolved",
          title: "Done",
        }),
        row({ id: "x", type: "status_update", related_issue_number: 99 }),
      ],
      issueTitles: { 7: "Renew the contract" },
    }),
  ]);
  assert.equal(meetings[0].rows[0].related_issue_title, "Renew the contract");
  assert.equal(meetings[0].rows[0].suggested_status, "resolved");
  assert.equal(meetings[0].rows[1].related_issue_title, null);
});

test("a meeting that ended 15 days ago is not listed, one from 13 days ago is", () => {
  const { meetings } = list([
    meeting({ meeting_id: "old", ended_at: daysAgo(15) }),
    meeting({ meeting_id: "recent", ended_at: daysAgo(13) }),
  ]);
  assert.deepEqual(
    meetings.map((m) => m.meeting_id),
    ["recent"],
  );
});

test("a meeting with only web-only items is not listed but is returned when asked for by id", () => {
  const onlyWeb = meeting({
    suggestions: [row({ category: "decision" }), row({ id: "i", category: "info" })],
  });
  assert.deepEqual(list([onlyWeb]).meetings, []);
  const one = buildReviewQueue({ me: "me-id", now, meetings: [onlyWeb], mode: "meeting" });
  assert.equal(one.meetings.length, 1);
  assert.deepEqual(one.meetings[0].rows, []);
  assert.equal(one.meetings[0].web_only_count, 2);
});

test("a meeting asked for by id is returned even when old or still being processed", () => {
  const old = meeting({
    ended_at: daysAgo(40),
    suggestions_status: "pending",
    suggestions: [],
  });
  const one = buildReviewQueue({ me: "me-id", now, meetings: [old], mode: "meeting" });
  assert.equal(one.meetings[0].suggestions_status, "pending");
});

test("a person who does not manage the series never sees its meeting in the list but can read it by id, read-only", () => {
  const readOnly = meeting({ reviewer: false });
  assert.deepEqual(list([readOnly]).meetings, []);
  const one = buildReviewQueue({ me: "me-id", now, meetings: [readOnly], mode: "meeting" });
  assert.equal(one.meetings[0].reviewer, false);
  assert.equal(one.meetings[0].rows.length, 1);
});

test("the list is newest first and a meeting that never ended is not listed", () => {
  const { meetings } = list([
    meeting({ meeting_id: "older", ended_at: daysAgo(5) }),
    meeting({ meeting_id: "newest", ended_at: daysAgo(1) }),
    meeting({ meeting_id: "noend", ended_at: null }),
  ]);
  assert.deepEqual(
    meetings.map((m) => m.meeting_id),
    ["newest", "older"],
  );
});

test("the status fields pass through under the exact names the Mac reads", () => {
  const { meetings } = list([
    meeting({ suggestions_status: "failed", suggestions_reason: "provider_error", status_at: "2026-11-20T10:00:00Z" }),
  ]);
  assert.equal(meetings[0].suggestions_status, "failed");
  assert.equal(meetings[0].suggestions_reason, "provider_error");
  assert.equal(meetings[0].status_at, "2026-11-20T10:00:00Z");
  assert.equal(meetings[0].transcription_status, "completed");
});
