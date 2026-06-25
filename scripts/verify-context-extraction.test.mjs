import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// MIN-121: Context-aware auto item extraction with series history.
//
// Bundle the pure context-builder logic so node:test can exercise it with a
// mock Supabase client (repo pattern, see verify-transcription-client). The DB
// fetch, the prompt formatting, and the referential-integrity normalization are
// all deterministic and testable without a network or a database.
const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-context-"));
const bundled = path.join(tempDir, "context-builder.mjs");
await esbuild.build({
  entryPoints: ["src/lib/ai/context-builder.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const {
  buildSeriesContext,
  formatSeriesContextForPrompt,
  normalizeSuggestions,
  OPEN_ISSUE_STATUSES,
} = await import(pathToFileURL(bundled).href);

// ---------------------------------------------------------------------------
// Mock Supabase: a chainable, thenable query builder that records every call so
// we can assert the context builder queries the right tables with the right
// filters, and maps the rows it gets back.
// ---------------------------------------------------------------------------
function createSupabaseRecorder(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const record = { table, select: null, filters: [], order: null, limit: null };
      calls.push(record);
      const builder = {
        select(cols) {
          record.select = cols;
          return builder;
        },
        eq(col, val) {
          record.filters.push(["eq", col, val]);
          return builder;
        },
        in(col, vals) {
          record.filters.push(["in", col, vals]);
          return builder;
        },
        order(col, opts) {
          record.order = [col, opts];
          return builder;
        },
        limit(n) {
          record.limit = n;
          return builder;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const SERIES_ID = "10000000-0000-0000-0000-000000000001";

function fixtureTables() {
  return {
    issues: [
      {
        issue_number: 45,
        title: "Support queue may spike after launch",
        category: "risk",
        status: "open",
        priority: "high",
        owner_name: "Alice",
        due_date: "2026-07-01",
      },
      {
        issue_number: 46,
        title: "Ship onboarding checklist",
        category: "action",
        status: "in_progress",
        priority: "medium",
        owner_name: "",
        due_date: null,
      },
    ],
    decisions: [
      {
        title: "Keep the launch scope small",
        rationale: "Reduce risk for the first release",
        made_by: "Carol",
        created_at: "2026-06-10T00:00:00.000Z",
      },
    ],
    issue_updates: [
      {
        previous_status: "open",
        new_status: "in_progress",
        note: "Started mitigation work",
        created_at: "2026-06-12T00:00:00.000Z",
        issue: { issue_number: 45, title: "Support queue may spike after launch", series_id: SERIES_ID },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// buildSeriesContext: fetches the right data, scoped to the series
// ---------------------------------------------------------------------------
test("buildSeriesContext queries open issues for the series across all meetings", async () => {
  const supabase = createSupabaseRecorder(fixtureTables());
  await buildSeriesContext(supabase, SERIES_ID);

  const issues = supabase.calls.find((c) => c.table === "issues");
  assert.ok(issues, "must query the issues table");
  assert.deepEqual(
    issues.filters.find((f) => f[0] === "eq"),
    ["eq", "series_id", SERIES_ID],
    "issues must be scoped to the series, not a single meeting"
  );
  const statusFilter = issues.filters.find((f) => f[0] === "in");
  assert.ok(statusFilter, "open issues must be filtered by status");
  assert.deepEqual([...statusFilter[2]].sort(), [...OPEN_ISSUE_STATUSES].sort());
  assert.equal(issues.limit, 50);
});

test("buildSeriesContext queries recent decisions and status changes for the series", async () => {
  const supabase = createSupabaseRecorder(fixtureTables());
  await buildSeriesContext(supabase, SERIES_ID);

  const decisions = supabase.calls.find((c) => c.table === "decisions");
  assert.ok(decisions, "must query the decisions table");
  assert.deepEqual(decisions.filters.find((f) => f[0] === "eq"), ["eq", "series_id", SERIES_ID]);

  const updates = supabase.calls.find((c) => c.table === "issue_updates");
  assert.ok(updates, "must query issue_updates for status-change history");
  // Scoped to the series via the embedded issue join, not a single meeting.
  assert.ok(
    updates.filters.some((f) => f[0] === "eq" && f[2] === SERIES_ID),
    "issue_updates must be scoped to the series"
  );
});

test("buildSeriesContext maps rows into a structured context", async () => {
  const supabase = createSupabaseRecorder(fixtureTables());
  const context = await buildSeriesContext(supabase, SERIES_ID);

  assert.equal(context.openIssues.length, 2);
  assert.equal(context.openIssues[0].issue_number, 45);
  assert.equal(context.openIssues[0].category, "risk");
  assert.equal(context.recentDecisions[0].title, "Keep the launch scope small");
  // The embedded issue is flattened onto the update for prompt rendering.
  assert.equal(context.recentUpdates[0].issue_number, 45);
  assert.equal(context.recentUpdates[0].new_status, "in_progress");
});

// ---------------------------------------------------------------------------
// formatSeriesContextForPrompt: deterministic, OIL-keyed rendering
// ---------------------------------------------------------------------------
test("formatSeriesContextForPrompt renders OIL keys, statuses, owners and decisions", async () => {
  const supabase = createSupabaseRecorder(fixtureTables());
  const context = await buildSeriesContext(supabase, SERIES_ID);
  const text = formatSeriesContextForPrompt(context);

  assert.match(text, /OIL-45/);
  assert.match(text, /\[risk\]/);
  assert.match(text, /status: open/);
  assert.match(text, /owner: Alice/);
  assert.match(text, /owner: unassigned/, "blank owner must read as unassigned, never empty");
  assert.match(text, /Keep the launch scope small/);
  assert.match(text, /by Carol/);
  assert.match(text, /OIL-45 open -> in_progress/, "status changes must show the transition");
});

test("formatSeriesContextForPrompt degrades gracefully with no history", () => {
  const text = formatSeriesContextForPrompt({ openIssues: [], recentDecisions: [], recentUpdates: [] });
  assert.match(text, /\(none\)/);
});

// ---------------------------------------------------------------------------
// normalizeSuggestions: enforce referential integrity so badges never dangle
// ---------------------------------------------------------------------------
const OPEN = [
  { issue_number: 45, status: "open" },
  { issue_number: 46, status: "in_progress" },
];

test("normalizeSuggestions clears stray references on a new_item", () => {
  const [s] = normalizeSuggestions(
    [{ type: "new_item", title: "x", related_issue_number: 45, suggested_status: "resolved" }],
    OPEN
  );
  assert.equal(s.type, "new_item");
  assert.equal(s.related_issue_number, null);
  assert.equal(s.suggested_status, null);
});

test("normalizeSuggestions keeps a valid status_update", () => {
  const [s] = normalizeSuggestions(
    [{ type: "status_update", title: "x", related_issue_number: 45, suggested_status: "resolved" }],
    OPEN
  );
  assert.equal(s.type, "status_update");
  assert.equal(s.related_issue_number, 45);
  assert.equal(s.suggested_status, "resolved");
});

test("normalizeSuggestions drops a status_update that points at an unknown issue", () => {
  const out = normalizeSuggestions(
    [{ type: "status_update", title: "x", related_issue_number: 999, suggested_status: "resolved" }],
    OPEN
  );
  assert.equal(out.length, 0, "a dangling reference must never reach the OIL board");
});

test("normalizeSuggestions drops a status_update with no target status", () => {
  const out = normalizeSuggestions(
    [{ type: "status_update", title: "x", related_issue_number: 45, suggested_status: null }],
    OPEN
  );
  assert.equal(out.length, 0);
});

test("normalizeSuggestions drops a no-op status_update to the current status", () => {
  const out = normalizeSuggestions(
    [{ type: "status_update", title: "x", related_issue_number: 45, suggested_status: "open" }],
    OPEN
  );
  assert.equal(out.length, 0, "suggesting the status it already has is noise");
});

test("normalizeSuggestions keeps a duplicate_warning that references a real open item", () => {
  const [s] = normalizeSuggestions(
    [{ type: "duplicate_warning", title: "x", related_issue_number: 46, suggested_status: "open" }],
    OPEN
  );
  assert.equal(s.type, "duplicate_warning");
  assert.equal(s.related_issue_number, 46);
  assert.equal(s.suggested_status, null, "a duplicate warning carries no status change");
});

test("normalizeSuggestions drops a duplicate_warning pointing nowhere", () => {
  const out = normalizeSuggestions(
    [{ type: "duplicate_warning", title: "x", related_issue_number: 999, suggested_status: null }],
    OPEN
  );
  assert.equal(out.length, 0);
});

// ---------------------------------------------------------------------------
// Static contract: schema, types, and route wiring carry the new shape end to end
// ---------------------------------------------------------------------------
test("migration adds the context-aware suggestion columns", () => {
  const migrationDir = path.join(root, "supabase", "migrations");
  const migrations = fs
    .readdirSync(migrationDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => fs.readFileSync(path.join(migrationDir, f), "utf8"))
    .join("\n");

  assert.match(migrations, /related_issue_number/, "missing related_issue_number column");
  assert.match(migrations, /suggested_status/, "missing suggested_status column");
  for (const t of ["new_item", "status_update", "duplicate_warning"]) {
    assert.ok(migrations.includes(t), `migration must constrain suggestion type ${t}`);
  }
});

test("MeetingAiSuggestion type carries the context-aware fields", () => {
  const types = read("src/lib/types.ts");
  for (const field of ["related_issue_number", "suggested_status", "SuggestionType"]) {
    assert.ok(types.includes(field), `types.ts missing ${field}`);
  }
});

test("context builder module is shared, not inlined", () => {
  assert.ok(exists("src/lib/ai/context-builder.ts"), "missing context-builder module");
  assert.ok(exists("src/lib/ai/suggestions.ts"), "missing shared suggestion generator module");
  const generator = read("src/lib/ai/suggestions.ts");
  assert.ok(generator.includes("buildSeriesContext"), "generator must use the series context");
  assert.ok(
    generator.includes("normalizeSuggestions"),
    "generator must normalize suggestions before persisting"
  );
});

test("suggestions route delegates to the shared context-aware generator", () => {
  const route = read("src/app/api/meetings/[meetingId]/suggestions/route.ts");
  assert.ok(route.includes("generateMeetingSuggestions"), "route must call the shared generator");
});

test("context-aware prompt instructs the model on past-context reasoning", () => {
  const generator = read("src/lib/ai/suggestions.ts");
  for (const phrase of ["status_update", "duplicate_warning", "OIL-"]) {
    assert.ok(generator.includes(phrase), `prompt must mention ${phrase}`);
  }
  // Preserve the accountability guardrails the existing AI-notes contract checks.
  assert.ok(generator.includes("Do not wrap it in markdown fences"));
  assert.ok(generator.includes("verbatim") && generator.includes("Never guess"));
});

test("review route applies a status_update to the existing issue with an audit trail", () => {
  const review = read("src/app/api/meetings/[meetingId]/suggestions/[suggestionId]/route.ts");
  assert.ok(review.includes("status_update"), "review route must branch on status_update");
  assert.ok(review.includes("issue_updates"), "accepting a status_update must write an audit row");
});

test("transcribe route auto-triggers context-aware extraction", () => {
  const transcribe = read("src/app/api/meetings/[meetingId]/transcribe/route.ts");
  assert.ok(
    transcribe.includes("generateMeetingSuggestions"),
    "completing a transcription must trigger suggestion extraction"
  );
});
