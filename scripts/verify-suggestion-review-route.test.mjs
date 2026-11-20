// Contract: PATCH in src/app/api/meetings/[meetingId]/suggestions/[suggestionId]/route.ts against an in-memory board.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "minutia-suggestion-review-"),
);
const stubDir = path.join(tempDir, "stubs");
fs.mkdirSync(stubDir, { recursive: true });

const S = {};
globalThis.__S = S;

fs.writeFileSync(
  path.join(stubDir, "next-server.mjs"),
  `
export const NextResponse = {
  json(body, init = {}) {
    const status = init.status ?? 200;
    return { status, ok: status >= 200 && status < 300, async json() { return body; } };
  },
};
export class NextRequest {}
`,
);
fs.writeFileSync(
  path.join(stubDir, "supabase-server.mjs"),
  `export async function createClient() { return globalThis.__S.client; }`,
);
fs.writeFileSync(
  path.join(stubDir, "service-role.mjs"),
  `export function createServiceRoleClient() { return globalThis.__S.client; }`,
);
fs.writeFileSync(
  path.join(stubDir, "manage-access.mjs"),
  `export async function userManagesSeries() { return true; }`,
);

function stubPlugin() {
  return {
    name: "suggestion-review-stubs",
    setup(build) {
      const map = {
        "@/lib/supabase/server": "supabase-server.mjs",
        "@/lib/supabase/service-role": "service-role.mjs",
        "@/lib/series/manage-access": "manage-access.mjs",
        "next/server": "next-server.mjs",
      };
      for (const [specifier, file] of Object.entries(map)) {
        const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
        build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
          path: path.join(stubDir, file),
        }));
      }
    },
  };
}

const outfile = path.join(tempDir, "route.mjs");
await esbuild.build({
  entryPoints: [
    "src/app/api/meetings/[meetingId]/suggestions/[suggestionId]/route.ts",
  ],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  plugins: [stubPlugin()],
});
const { PATCH } = await import(pathToFileURL(outfile).href);

const USER_ID = "10000000-0000-0000-0000-000000000001";
const SERIES_ID = "20000000-0000-0000-0000-000000000001";
const MEETING_ID = "30000000-0000-0000-0000-000000000001";
const SUGGESTION_ID = "40000000-0000-0000-0000-000000000001";
const STALE_MS = 2 * 60 * 1000;

function query(table, op, payload) {
  const filters = [];
  const matches = (row) =>
    filters.every(([col, value, kind]) =>
      kind === "in" ? value.includes(row[col]) : row[col] === value,
    );
  const run = () => {
    const rows = S.db[table];
    const fail = S.failures.find(
      (f) => f.table === table && f.op === op && f.when(payload ?? {}),
    );
    if (fail) {
      S.failures.splice(S.failures.indexOf(fail), 1);
      return { data: null, error: { message: "write failed" } };
    }
    if (op === "insert") {
      const row = { id: `${table}-${rows.length + 1}`, ...payload };
      rows.push(row);
      return { data: [row], error: null };
    }
    const hits = rows.filter(matches);
    if (op === "update") hits.forEach((row) => Object.assign(row, payload));
    return { data: hits.map((row) => ({ ...row })), error: null };
  };
  const builder = {
    select() {
      return builder;
    },
    eq(col, value) {
      filters.push([col, value, "eq"]);
      return builder;
    },
    in(col, value) {
      filters.push([col, value, "in"]);
      return builder;
    },
    order() {
      return builder;
    },
    async single() {
      const { data, error } = run();
      if (error) return { data: null, error };
      return data.length === 1
        ? { data: data[0], error: null }
        : { data: null, error: { message: "not single" } };
    },
    async maybeSingle() {
      const { data, error } = run();
      if (error) return { data: null, error };
      return { data: data[0] ?? null, error: null };
    },
    then(resolve, reject) {
      return Promise.resolve(run()).then(resolve, reject);
    },
  };
  return builder;
}

function buildClient() {
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: USER_ID } }, error: null };
      },
    },
    from(table) {
      return {
        select: () => query(table, "select"),
        insert: (row) => query(table, "insert", row),
        update: (patch) => query(table, "update", patch),
      };
    },
    async rpc(fn, { p_suggestion_id }) {
      const row = S.db.meeting_ai_suggestions.find(
        (r) => r.id === p_suggestion_id,
      );
      if (fn === "claim_ai_suggestion") {
        const stale =
          row.status === "reviewing" &&
          Date.now() - Date.parse(row.reviewing_at) > STALE_MS;
        if (row.status !== "pending" && !stale)
          return { data: false, error: null };
        Object.assign(row, {
          status: "reviewing",
          reviewing_at: new Date().toISOString(),
        });
        return { data: true, error: null };
      }
      if (row.status === "reviewing")
        Object.assign(row, { status: "pending", reviewing_at: null });
      return { data: null, error: null };
    },
  };
}

function reset(suggestion) {
  S.failures = [];
  S.client = buildClient();
  S.db = {
    meeting_series: [{ id: SERIES_ID, owner_id: USER_ID }],
    series_participants: [],
    profiles: [{ id: USER_ID, name: "Pat Owner" }],
    issues: [
      {
        id: "issue-existing",
        series_id: SERIES_ID,
        issue_number: 7,
        status: "open",
      },
    ],
    issue_updates: [],
    decisions: [],
    meeting_ai_suggestions: [
      {
        id: SUGGESTION_ID,
        meeting_id: MEETING_ID,
        series_id: SERIES_ID,
        type: "new_item",
        category: "action",
        title: "Send the vendor contract",
        details: "",
        owner_name: "",
        due_date: null,
        confidence: 0.9,
        source_excerpt: "",
        related_issue_number: null,
        suggested_status: null,
        status: "pending",
        reviewing_at: null,
        ...suggestion,
      },
    ],
  };
}

async function keep() {
  const response = await PATCH(
    {
      async json() {
        return { action: "accept" };
      },
    },
    {
      params: Promise.resolve({
        meetingId: MEETING_ID,
        suggestionId: SUGGESTION_ID,
      }),
    },
  );
  return { status: response.status, body: await response.json() };
}

const suggestionRow = () => S.db.meeting_ai_suggestions[0];
const newBoardItems = () =>
  S.db.issues.filter((i) => i.id !== "issue-existing").map((i) => i.title);
const markAccepted = (patch) => patch.status === "accepted";

test("a retry after the final save failed does not add a second board item", async () => {
  reset();
  S.failures.push({
    table: "meeting_ai_suggestions",
    op: "update",
    when: markAccepted,
  });

  const first = await keep();
  assert.deepEqual([first.status, first.body.code], [500, "save_failed"]);
  assert.deepEqual(newBoardItems(), ["Send the vendor contract"]);
  assert.equal(suggestionRow().status, "reviewing");

  const retry = await keep();
  assert.deepEqual([retry.status, retry.body.code], [409, "already_reviewed"]);
  assert.deepEqual(newBoardItems(), ["Send the vendor contract"]);
});

test("a save that failed before anything landed lets the retry keep the item once", async () => {
  reset();
  S.failures.push({ table: "issues", op: "insert", when: () => true });

  const first = await keep();
  assert.deepEqual([first.status, first.body.code], [500, "save_failed"]);
  assert.deepEqual(newBoardItems(), []);
  assert.equal(suggestionRow().status, "pending");

  const retry = await keep();
  assert.deepEqual([retry.status, retry.body.code], [200, "saved"]);
  assert.deepEqual(newBoardItems(), ["Send the vendor contract"]);
  assert.equal(suggestionRow().status, "accepted");
});

test("a status change that landed before its history note failed is not applied twice", async () => {
  reset({
    type: "status_update",
    category: "risk",
    related_issue_number: 7,
    suggested_status: "resolved",
  });
  S.failures.push({ table: "issue_updates", op: "insert", when: () => true });

  const first = await keep();
  assert.deepEqual([first.status, first.body.code], [500, "save_failed"]);
  assert.equal(S.db.issues[0].status, "resolved");
  assert.equal(suggestionRow().status, "reviewing");

  const retry = await keep();
  assert.deepEqual([retry.status, retry.body.code], [409, "already_reviewed"]);
  assert.equal(S.db.issue_updates.length, 0);
});

test("a final save that loses its claim to another keep does not mark the item accepted", async () => {
  reset();
  S.failures.push({
    table: "issues",
    op: "insert",
    when: () => {
      Object.assign(suggestionRow(), { status: "rejected" });
      return false;
    },
  });

  const response = await keep();
  assert.deepEqual([response.status, response.body.code], [500, "save_failed"]);
  assert.equal(suggestionRow().status, "rejected");
});
