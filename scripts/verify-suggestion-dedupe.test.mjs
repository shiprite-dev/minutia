import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "minutia-suggestion-dedupe-"),
);
const stubDir = path.join(tempDir, "stubs");
fs.mkdirSync(stubDir, { recursive: true });

const stubs = {
  "service-role.mjs": `export function createServiceRoleClient() { return { from() { return { update() { return { async eq() { return { error: null }; } }; } }; } }; }`,
  "server.mjs": `export async function createClient() { return null; }`,
  "config.mjs": `export async function hasAiConfigured() { return true; }`,
  "call.mjs": `export async function callAi() { return { data: globalThis.__S.providerData, model: "m1" }; }`,
  "ask.mjs": `export function getTextFromOpenRouter(data) { return data; }`,
  "notes.mjs": `export function composeMeetingNotes(meeting) { return meeting.notes ?? ""; }`,
  "context.mjs": `
export async function buildSeriesContext() { return { openIssues: [] }; }
export function formatSeriesContextForPrompt() { return ""; }
export function normalizeSuggestions(list) { return list; }
export function resolveDueDate(d) { return d; }
`,
};
for (const [file, src] of Object.entries(stubs))
  fs.writeFileSync(path.join(stubDir, file), src);

const map = {
  "@/lib/supabase/service-role": "service-role.mjs",
  "@/lib/supabase/server": "server.mjs",
  "@/lib/ai/config": "config.mjs",
  "./call": "call.mjs",
  "./ask-series-answer": "ask.mjs",
  "./companion-notes": "notes.mjs",
  "./context-builder": "context.mjs",
};

const outfile = path.join(tempDir, "suggestions.mjs");
await esbuild.build({
  entryPoints: ["src/lib/ai/suggestions.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  plugins: [
    {
      name: "stubs",
      setup(instance) {
        for (const [spec, file] of Object.entries(map)) {
          instance.onResolve(
            {
              filter: new RegExp(
                `^${spec.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`,
              ),
            },
            () => ({ path: path.join(stubDir, file) }),
          );
        }
      },
    },
  ],
});
const lib = await import(pathToFileURL(outfile).href);

const S = {};
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

function fakeSupabase(rows) {
  const store = { rows: rows.map((r) => ({ ...r })), inserted: [] };
  const client = {
    from(table) {
      if (table === "meetings") {
        const b = {
          select: () => b,
          eq: () => b,
          single: async () => ({ data: MEETING_ROW, error: null }),
        };
        return b;
      }
      const filters = [];
      let op = "select";
      let payload;
      const b = {
        select: () => b,
        order: () => b,
        eq: (col, val) => (filters.push((r) => r[col] === val), b),
        neq: (col, val) => (filters.push((r) => r[col] !== val), b),
        delete: () => ((op = "delete"), b),
        insert: (p) => ((op = "insert"), (payload = p), b),
        then(resolve) {
          const match = (r) => filters.every((f) => f(r));
          if (op === "delete") store.rows = store.rows.filter((r) => !match(r));
          if (op === "insert") {
            store.inserted = payload;
            store.rows.push(
              ...payload.map((r) => ({ status: "pending", ...r })),
            );
            return resolve({ data: payload, error: null });
          }
          return resolve({ data: store.rows.filter(match), error: null });
        },
      };
      return b;
    },
  };
  return { client, store };
}

const suggestion = (title) => ({ category: "action", title });
const run = async (existing, titles) => {
  S.providerData = JSON.stringify({ suggestions: titles.map(suggestion) });
  const { client, store } = fakeSupabase(existing);
  const out = await lib.generateMeetingSuggestions(client, MEETING_ID);
  return { out, store };
};

test("a title differing only in case, spacing and trailing punctuation matches", () => {
  assert.equal(
    lib.normalizeSuggestionTitle("  Send  the\tPricing   Draft.  "),
    "send the pricing draft",
  );
  assert.equal(lib.normalizeSuggestionTitle("Ship it!?"), "ship it");
  assert.equal(
    lib.normalizeSuggestionTitle("Book Acme interview"),
    "book acme interview",
  );
});

test("a reviewed title never comes back but a genuinely new one stays", () => {
  const rows = [
    { title: "send the  pricing draft" },
    { title: "Book Acme interview" },
  ];
  assert.deepEqual(lib.dropAlreadyReviewed(rows, ["Send the pricing draft."]), [
    { title: "Book Acme interview" },
  ]);
});

test("with nothing reviewed every suggestion stays", () => {
  const rows = [{ title: "A" }, { title: "B" }];
  assert.deepEqual(lib.dropAlreadyReviewed(rows, []), rows);
});

test("a different title is not mistaken for a reviewed one", () => {
  const rows = [{ title: "Send the pricing draft to Acme" }];
  assert.deepEqual(
    lib.dropAlreadyReviewed(rows, ["Send the pricing draft"]),
    rows,
  );
});

test("a re-run does not bring back an item the person already kept", async () => {
  const { out, store } = await run(
    [
      {
        meeting_id: MEETING_ID,
        status: "accepted",
        title: "Send the pricing draft.",
      },
    ],
    ["send the  pricing draft", "Book Acme interview"],
  );
  assert.equal(out.ok, true);
  assert.deepEqual(
    store.inserted.map((r) => r.title),
    ["Book Acme interview"],
  );
  assert.deepEqual(
    out.suggestions.map((r) => r.title),
    ["Book Acme interview"],
  );
});

test("a re-run does not bring back an item the person already skipped", async () => {
  const { store } = await run(
    [
      {
        meeting_id: MEETING_ID,
        status: "rejected",
        title: "Book Acme interview",
      },
    ],
    ["Book Acme interview"],
  );
  assert.deepEqual(store.inserted, []);
  assert.deepEqual(
    store.rows.map((r) => r.status),
    ["rejected"],
  );
});

test("a re-run still refreshes items nobody has reviewed yet", async () => {
  const { store } = await run(
    [{ meeting_id: MEETING_ID, status: "pending", title: "Old pending item" }],
    ["Old pending item", "Book Acme interview"],
  );
  assert.deepEqual(
    store.rows.map((r) => r.title),
    ["Old pending item", "Book Acme interview"],
  );
});

test("another meeting's reviewed items do not hide this meeting's suggestions", async () => {
  const { store } = await run(
    [{ meeting_id: "other", status: "accepted", title: "Book Acme interview" }],
    ["Book Acme interview"],
  );
  assert.deepEqual(
    store.inserted.map((r) => r.title),
    ["Book Acme interview"],
  );
});

test("when every suggestion was already reviewed the list ends empty and ready", async () => {
  const { out, store } = await run(
    [
      {
        meeting_id: MEETING_ID,
        status: "accepted",
        title: "Book Acme interview",
      },
    ],
    ["Book Acme interview"],
  );
  assert.equal(out.ok, true);
  assert.deepEqual(out.suggestions, []);
  assert.deepEqual(store.inserted, []);
});
