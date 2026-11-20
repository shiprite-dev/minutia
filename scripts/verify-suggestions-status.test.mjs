import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "minutia-suggestions-status-"),
);
const stubDir = path.join(tempDir, "stubs");
fs.mkdirSync(stubDir, { recursive: true });

const S = {};

fs.writeFileSync(
  path.join(stubDir, "service-role.mjs"),
  `
export function createServiceRoleClient() {
  return {
    from(table) {
      return {
        update(row) {
          return {
            async eq(col, id) {
              const S = globalThis.__S;
              if (S.writeError) return { error: { message: "write failed" } };
              S.writes.push({ table, row, col, id });
              return { error: null };
            },
          };
        },
      };
    },
  };
}
`,
);
fs.writeFileSync(
  path.join(stubDir, "server.mjs"),
  `
export async function createClient() { return globalThis.__S.userClient; }
`,
);
fs.writeFileSync(
  path.join(stubDir, "manage-access.mjs"),
  `
export async function userManagesSeries() {
  return globalThis.__S.manages === true;
}
`,
);
fs.writeFileSync(
  path.join(stubDir, "config.mjs"),
  `
export async function hasAiConfigured() { return globalThis.__S.configured; }
`,
);
fs.writeFileSync(
  path.join(stubDir, "call.mjs"),
  `
export async function callAi() {
  const S = globalThis.__S;
  if (S.providerThrows) throw S.providerThrows;
  return { data: S.providerData, model: "m1" };
}
`,
);
fs.writeFileSync(
  path.join(stubDir, "ask.mjs"),
  `
export function getTextFromOpenRouter(data) { return data; }
`,
);
fs.writeFileSync(
  path.join(stubDir, "notes.mjs"),
  `
export function composeMeetingNotes(meeting) { return meeting.notes ?? ""; }
`,
);
fs.writeFileSync(
  path.join(stubDir, "context.mjs"),
  `
export async function buildSeriesContext() { return { openIssues: [] }; }
export function formatSeriesContextForPrompt() { return ""; }
export function normalizeSuggestions(list) { return list; }
export function resolveDueDate(d) { return d; }
`,
);

function stubPlugin() {
  const map = {
    "@/lib/supabase/service-role": "service-role.mjs",
    "@/lib/supabase/server": "server.mjs",
    "@/lib/series/manage-access": "manage-access.mjs",
    "@/lib/ai/config": "config.mjs",
    "./call": "call.mjs",
    "./ask-series-answer": "ask.mjs",
    "./companion-notes": "notes.mjs",
    "./context-builder": "context.mjs",
  };
  return {
    name: "stubs",
    setup(instance) {
      for (const [spec, file] of Object.entries(map)) {
        instance.onResolve(
          {
            filter: new RegExp(
              `^${spec.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`,
            ),
          },
          () => ({
            path: path.join(stubDir, file),
          }),
        );
      }
    },
  };
}

async function bundle(entry, name) {
  const outfile = path.join(tempDir, name);
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    absWorkingDir: root,
    plugins: [stubPlugin()],
  });
  return import(pathToFileURL(outfile).href);
}

const status = await bundle("src/lib/ai/suggestions-status.ts", "status.mjs");
const generator = await bundle("src/lib/ai/suggestions.ts", "generator.mjs");
globalThis.__S = S;

const MEETING_ID = "30000000-0000-0000-0000-000000000003";
const MEETING_ROW = {
  id: MEETING_ID,
  series_id: "s1",
  title: "Weekly sync",
  date: "2026-11-20",
  attendees: [],
  notes: "we agreed",
  transcript_raw: "",
  series: { name: "Weekly" },
};

function reset(overrides = {}) {
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(
    S,
    {
      writes: [],
      writeError: false,
      configured: true,
      providerThrows: null,
      providerData: JSON.stringify({ suggestions: [] }),
      manages: true,
      user: { id: "u1" },
      meetingRow: MEETING_ROW,
      insertedRows: [{ id: "a" }],
    },
    overrides,
  );
  S.userClient = {
    auth: {
      async getUser() {
        return { data: { user: S.user } };
      },
    },
    from() {
      const b = {
        select: () => b,
        eq: () => b,
        single: async () => ({ data: S.meetingRow, error: null }),
      };
      return b;
    },
  };
}

function generatorClient() {
  return {
    from(table) {
      let reviewedRead = false;
      const b = {
        select: () => b,
        eq: () => b,
        neq: () => ((reviewedRead = true), b),
        order: () => b,
        delete: () => b,
        insert: () => b,
        single: async () =>
          S.meetingRow
            ? { data: S.meetingRow, error: null }
            : { data: null, error: { message: "nf" } },
        async then(resolve) {
          return resolve({
            data:
              table === "meeting_ai_suggestions"
                ? reviewedRead
                  ? []
                  : S.insertedRows
                : null,
            error: null,
          });
        },
      };
      return b;
    },
  };
}

const lastWrite = () => S.writes.at(-1);

test("a finished extraction with or without items tells the person it is ready", () => {
  assert.deepEqual(
    status.suggestionsStatusFor({ ok: true, suggestions: [], model: "m" }),
    { status: "ready", reason: null },
  );
  assert.deepEqual(
    status.suggestionsStatusFor({ ok: true, suggestions: [{}], model: "m" }),
    { status: "ready", reason: null },
  );
});

test("nothing to extract or no AI set up is a skip with its own reason, not a failure", () => {
  assert.deepEqual(
    status.suggestionsStatusFor({
      ok: false,
      status: 400,
      error: "",
      code: "skipped_no_content",
    }),
    { status: "skipped", reason: "no_content" },
  );
  assert.deepEqual(
    status.suggestionsStatusFor({
      ok: false,
      status: 503,
      error: "",
      code: "skipped_unconfigured",
    }),
    { status: "skipped", reason: "not_configured" },
  );
});

test("every other extraction failure is reported as failed with its code", () => {
  for (const code of [
    "provider_error",
    "invalid_suggestions",
    "save_failed",
    "context_unavailable",
    "not_found",
  ]) {
    assert.deepEqual(
      status.suggestionsStatusFor({ ok: false, status: 500, error: "", code }),
      { status: "failed", reason: code },
    );
  }
});

test("marking pending stamps the meeting as pending with no reason and a time", async () => {
  reset();
  await status.markSuggestionsPending(MEETING_ID);
  assert.equal(S.writes.length, 1);
  assert.equal(lastWrite().table, "meetings");
  assert.equal(lastWrite().id, MEETING_ID);
  assert.equal(lastWrite().row.suggestions_status, "pending");
  assert.equal(lastWrite().row.suggestions_reason, null);
  assert.ok(Number.isFinite(Date.parse(lastWrite().row.suggestions_status_at)));
});

test("a status write that fails never breaks the recording pipeline", async () => {
  reset({ writeError: true });
  await status.markSuggestionsPending(MEETING_ID);
  await status.recordSuggestionsStatus(MEETING_ID, {
    status: "ready",
    reason: null,
  });
  assert.equal(S.writes.length, 0);
});

test("a series manager without AI access sees the meeting skipped as feature unavailable", async () => {
  reset();
  await status.recordFeatureUnavailable(MEETING_ID);
  assert.equal(S.writes.length, 1);
  assert.equal(lastWrite().id, MEETING_ID);
  assert.equal(lastWrite().row.suggestions_status, "skipped");
  assert.equal(lastWrite().row.suggestions_reason, "feature_unavailable");
});

test("a signed-out caller or a non-manager cannot change another meeting's status", async () => {
  reset({ user: null });
  await status.recordFeatureUnavailable(MEETING_ID);
  reset({ manages: false });
  await status.recordFeatureUnavailable(MEETING_ID);
  reset({ meetingRow: null });
  await status.recordFeatureUnavailable(MEETING_ID);
  assert.equal(S.writes.length, 0);
});

test("a meeting whose action items are already ready keeps them when AI access is later missing", async () => {
  reset({ meetingRow: { ...MEETING_ROW, suggestions_status: "ready" } });
  await status.recordFeatureUnavailable(MEETING_ID);
  assert.deepEqual(S.writes, []);
  reset({ meetingRow: { ...MEETING_ROW, suggestions_status: "pending" } });
  await status.recordFeatureUnavailable(MEETING_ID);
  assert.equal(lastWrite().row.suggestions_status, "skipped");
});

test("action items found are saved and the meeting ends ready", async () => {
  reset({
    providerData: JSON.stringify({
      suggestions: [{ category: "action", title: "Send deck" }],
    }),
  });
  const out = await generator.generateMeetingSuggestions(
    generatorClient(),
    MEETING_ID,
  );
  assert.equal(out.ok, true);
  assert.equal(S.writes.length, 1);
  assert.equal(lastWrite().row.suggestions_status, "ready");
  assert.equal(lastWrite().row.suggestions_reason, null);
});

test("a meeting with no action items still ends ready", async () => {
  reset();
  const out = await generator.generateMeetingSuggestions(
    generatorClient(),
    MEETING_ID,
  );
  assert.deepEqual(out.suggestions, []);
  assert.equal(S.writes.length, 1);
  assert.equal(lastWrite().row.suggestions_status, "ready");
});

test("a meeting with nothing said or written ends skipped for no content", async () => {
  reset({ meetingRow: { ...MEETING_ROW, notes: "" } });
  await generator.generateMeetingSuggestions(generatorClient(), MEETING_ID);
  assert.equal(S.writes.length, 1);
  assert.equal(lastWrite().row.suggestions_status, "skipped");
  assert.equal(lastWrite().row.suggestions_reason, "no_content");
});

test("an instance without AI ends skipped as not configured", async () => {
  reset({ configured: false });
  await generator.generateMeetingSuggestions(generatorClient(), MEETING_ID);
  assert.equal(S.writes.length, 1);
  assert.equal(lastWrite().row.suggestions_status, "skipped");
  assert.equal(lastWrite().row.suggestions_reason, "not_configured");
});

test("an AI provider error ends failed with the provider reason", async () => {
  reset({ providerThrows: new Error("503") });
  const out = await generator.generateMeetingSuggestions(
    generatorClient(),
    MEETING_ID,
  );
  assert.equal(out.code, "provider_error");
  assert.equal(S.writes.length, 1);
  assert.equal(lastWrite().row.suggestions_status, "failed");
  assert.equal(lastWrite().row.suggestions_reason, "provider_error");
});

test("an unreadable AI reply ends failed as invalid suggestions", async () => {
  reset({ providerData: "not json" });
  const out = await generator.generateMeetingSuggestions(
    generatorClient(),
    MEETING_ID,
  );
  assert.equal(out.code, "invalid_suggestions");
  assert.equal(lastWrite().row.suggestions_status, "failed");
  assert.equal(lastWrite().row.suggestions_reason, "invalid_suggestions");
});

test("an unexpected crash marks the meeting failed and still surfaces the crash", async () => {
  reset();
  const boom = new Error("db down");
  const client = {
    from() {
      throw boom;
    },
  };
  await assert.rejects(
    generator.generateMeetingSuggestions(client, MEETING_ID),
    (e) => e === boom,
  );
  assert.equal(S.writes.length, 1);
  assert.equal(lastWrite().row.suggestions_status, "failed");
  assert.equal(lastWrite().row.suggestions_reason, "provider_error");
});
