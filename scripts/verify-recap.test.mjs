import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-recap-"));
const stubDir = path.join(tempDir, "stubs");
fs.mkdirSync(stubDir);

const MEETING_ID = "20000000-0000-0000-0000-0000000000aa";
const MODEL = "test-model";
const SERIES_ID = "10000000-0000-0000-0000-0000000000aa";
const USER_ID = "00000000-0000-0000-0000-0000000000aa";

fs.writeFileSync(
  path.join(stubDir, "supabase-server.mjs"),
  "export async function createClient() { return globalThis.__R.supabase(); }\n",
);
fs.writeFileSync(
  path.join(stubDir, "access.mjs"),
  "export async function requireAiAccess() { return null; }\n",
);
fs.writeFileSync(
  path.join(stubDir, "config.mjs"),
  `export async function getAiConfig() { return { provider: "openai-compatible", baseUrl: "https://example.com", apiKey: "k", model: ${JSON.stringify(MODEL)} }; }\n`,
);
fs.writeFileSync(
  path.join(stubDir, "stream.mjs"),
  "export function streamAi(input) { return globalThis.__R.streamAi(input); }\n",
);
fs.writeFileSync(
  path.join(stubDir, "manage-access.mjs"),
  "export async function userManagesSeries(seriesId, userId) { return globalThis.__R.manages(seriesId, userId); }\n",
);
fs.writeFileSync(
  path.join(stubDir, "next-server.mjs"),
  [
    "export const NextResponse = {",
    "  json(body, init) {",
    "    return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { 'content-type': 'application/json' } });",
    "  },",
    "};",
    "",
  ].join("\n"),
);

function stubPlugin() {
  return {
    name: "recap-route-stubs",
    setup(instance) {
      const map = {
        "@/lib/supabase/server": "supabase-server.mjs",
        "@/lib/ai/access": "access.mjs",
        "@/lib/ai/config": "config.mjs",
        "@/lib/ai/stream": "stream.mjs",
        "@/lib/series/manage-access": "manage-access.mjs",
        "next/server": "next-server.mjs",
      };
      for (const [specifier, file] of Object.entries(map)) {
        const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
        instance.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
          path: path.join(stubDir, file),
        }));
      }
    },
  };
}

async function bundle(entry, name, plugins = []) {
  const outfile = path.join(tempDir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    absWorkingDir: root,
    plugins,
  });
  return import(pathToFileURL(outfile).href);
}

const recap = await bundle("src/lib/summary/recap.ts", "recap");
const sse = await bundle("src/lib/summary/sse.ts", "sse");
const route = await bundle(
  "src/app/api/meetings/[meetingId]/summary/stream/route.ts",
  "summary-stream-route",
  [stubPlugin()],
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A minimal PostgREST double. Records every awaited update with its filters.
// It has no .or()/.and(): self-hosted PostgREST ignores those on UPDATE, so
// the route must target the row with .eq("id", ...) alone.
function fakeSupabase(state) {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: state.user }, error: null }),
    },
    from(table) {
      const q = {
        update(row) {
          q._update = row;
          return q;
        },
        select() {
          return q;
        },
        eq(column, value) {
          q._filters.push([column, value]);
          return q;
        },
        is(column, value) {
          q._filters.push([column, "is", value]);
          return q;
        },
        order() {
          return q;
        },
        single() {
          return Promise.resolve({ data: state.meeting, error: null });
        },
        then(resolve, reject) {
          if (q._update) {
            state.updates.push({ table, row: q._update, filters: q._filters });
            return Promise.resolve({
              data: null,
              error: state.updateError,
            }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(
            resolve,
            reject,
          );
        },
        _update: null,
        _filters: [],
      };
      return q;
    },
  };
}

function setup(streamAi, overrides = {}) {
  const state = {
    meeting: {
      series_id: SERIES_ID,
      title: "Weekly sync",
      attendees: ["Mike Ross"],
      notes_markdown: "",
      raw_notes_markdown: null,
      transcript_raw: "Mike Ross: I will own the migration review.",
      series: { name: "Platform" },
    },
    user: { id: USER_ID },
    manages: true,
    manageChecks: [],
    streamCalls: 0,
    updates: [],
    updateError: null,
    ...overrides,
  };
  globalThis.__R = {
    supabase: () => fakeSupabase(state),
    streamAi: (input) => {
      state.streamCalls += 1;
      return streamAi(input);
    },
    manages: async (seriesId, userId) => {
      state.manageChecks.push([seriesId, userId]);
      return state.manages;
    },
  };
  return state;
}

function post(signal, query = "") {
  const request = {
    signal: signal ?? new AbortController().signal,
    url: `http://localhost/api/meetings/${MEETING_ID}/summary/stream${query}`,
  };
  return route.POST(request, {
    params: Promise.resolve({ meetingId: MEETING_ID }),
  });
}

function wordsFrom(body) {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data))
    .filter((frame) => typeof frame.t === "string")
    .map((frame) => frame.t)
    .join("");
}

// ---------------------------------------------------------------------------
// Stream route persistence
// ---------------------------------------------------------------------------

test("a completed recap stream stores the text, time and model on the meeting before [DONE]", async () => {
  const state = setup(async function* () {
    yield "Mike Ross ";
    yield "owns the migration review.";
  });

  const before = Date.now();
  const response = await post();
  assert.equal(response.status, 200);
  const body = await response.text();

  assert.equal(wordsFrom(body), "Mike Ross owns the migration review.");
  assert.ok(body.trimEnd().endsWith("data: [DONE]"));
  assert.ok(!body.includes(sse.SSE_ERROR), "a finished recap sends no error frame");

  const recapUpdates = state.updates.filter((u) => "recap_markdown" in u.row);
  assert.equal(recapUpdates.length, 1, "exactly one recap write");
  const [{ table, row, filters }] = recapUpdates;
  assert.equal(table, "meetings");
  // A plain is-null filter: self-hosted PostgREST honors it on UPDATE, unlike or()/and().
  assert.deepEqual(filters, [
    ["id", MEETING_ID],
    ["recap_markdown", "is", null],
  ]);
  assert.equal(row.recap_markdown, "Mike Ross owns the migration review.");
  assert.equal(row.recap_model, MODEL);
  const stamp = new Date(row.recap_generated_at).getTime();
  assert.ok(
    Number.isFinite(stamp) &&
      stamp >= before - 1000 &&
      stamp <= Date.now() + 1000,
  );
});

test("a provider error mid-stream ends the stream but writes nothing", async () => {
  const state = setup(async function* () {
    yield "Partial ";
    throw new Error("provider down");
  });

  const body = await (await post()).text();
  assert.equal(wordsFrom(body), "Partial ");
  assert.ok(body.includes(sse.SSE_ERROR), "the client is told the recap failed");
  assert.ok(body.trimEnd().endsWith("data: [DONE]"));
  assert.ok(body.indexOf(sse.SSE_ERROR) < body.lastIndexOf("data: [DONE]"));
  assert.equal(state.updates.length, 0);
});

test("a provider failure before the first word sends an error frame and writes nothing", async () => {
  const state = setup(async function* () {
    throw new Error("401 Unauthorized");
  });

  const response = await post();
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(sse.SSE_ERROR, "sse.ts exports an SSE_ERROR frame");
  assert.equal(wordsFrom(body), "");
  assert.ok(body.includes(sse.SSE_ERROR));
  assert.ok(body.indexOf(sse.SSE_ERROR) < body.lastIndexOf("data: [DONE]"));
  assert.equal(state.updates.length, 0);
});

test("a client abort writes nothing even when the provider keeps yielding", async () => {
  // The provider ignores the abort signal and finishes normally, so the route
  // itself must notice the abort and skip the write.
  const state = setup(async function* () {
    yield "Alpha ";
    await sleep(80);
    yield "Beta.";
  });

  const controller = new AbortController();
  const response = await post(controller.signal);
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  await sleep(50);
  assert.equal(state.updates.length, 0);
});

test("a cancelled response body writes nothing", async () => {
  const state = setup(async function* () {
    yield "Alpha ";
    await sleep(80);
    yield "Beta.";
  });

  const controller = new AbortController();
  const response = await post(controller.signal);
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  await reader.cancel();
  await sleep(200);
  assert.equal(state.updates.length, 0);
});

test("an empty provider response sends an error frame and writes nothing", async () => {
  const state = setup(async function* () {});
  const body = await (await post()).text();
  assert.ok(body.includes(sse.SSE_ERROR));
  assert.ok(body.trimEnd().endsWith("data: [DONE]"));
  assert.equal(state.updates.length, 0);
});

test("a failed write still settles the stream with [DONE] and logs the meeting id", async () => {
  const state = setup(
    async function* () {
      yield "Recap text.";
    },
    { updateError: { message: "permission denied" } },
  );
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.map(String).join(" "));
  let body;
  try {
    body = await (await post()).text();
  } finally {
    console.error = original;
  }
  assert.equal(wordsFrom(body), "Recap text.");
  assert.ok(body.trimEnd().endsWith("data: [DONE]"));
  assert.equal(state.updates.length, 1);
  assert.equal(logged.length, 1, "one console.error for the failed write");
  assert.match(logged[0], new RegExp(MEETING_ID));
  assert.match(logged[0], /permission denied/);
  assert.doesNotMatch(logged[0], /apiKey|Bearer/);
});

test("Regenerate overwrites the stored recap without the is-null guard", async () => {
  const state = setup(async function* () {
    yield "Fresh recap.";
  });
  const body = await (await post(undefined, "?regenerate=1")).text();
  assert.equal(wordsFrom(body), "Fresh recap.");
  assert.equal(state.updates.length, 1);
  assert.deepEqual(state.updates[0].filters, [["id", MEETING_ID]]);
  assert.equal(state.updates[0].row.recap_markdown, "Fresh recap.");
});

test("a member who does not manage the series gets 403, no stream and no write", async () => {
  const state = setup(
    async function* () {
      yield "Should never stream.";
    },
    { manages: false },
  );
  const response = await post();
  assert.equal(response.status, 403);
  assert.match(response.headers.get("content-type") ?? "", /json/);
  assert.equal(state.streamCalls, 0);
  assert.equal(state.updates.length, 0);
  assert.deepEqual(state.manageChecks, [[SERIES_ID, USER_ID]]);
});

test("a signed-out caller gets 403 without a manager lookup", async () => {
  const state = setup(
    async function* () {
      yield "Should never stream.";
    },
    { user: null },
  );
  const response = await post();
  assert.equal(response.status, 403);
  assert.equal(state.streamCalls, 0);
  assert.equal(state.updates.length, 0);
  assert.deepEqual(state.manageChecks, []);
});

test("a meeting with only desktop notepad notes still gets a stored recap", async () => {
  let prompt = "";
  const state = setup(
    async function* (input) {
      prompt = input.prompt;
      yield "Vendor review moves to Thursday.";
    },
    {
      meeting: {
        series_id: SERIES_ID,
        title: "Weekly sync",
        attendees: [],
        notes_markdown: "",
        raw_notes_markdown: null,
        companion_notes_markdown: "Desk note: vendor review moves to Thursday.",
        transcript_raw: null,
        series: { name: "Platform" },
      },
    },
  );
  const response = await post();
  assert.equal(response.status, 200);
  await response.text();
  assert.match(prompt, /Desk note: vendor review moves to Thursday\./);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].row.recap_markdown, "Vendor review moves to Thursday.");
});

// ---------------------------------------------------------------------------
// Pure recap core
// ---------------------------------------------------------------------------

test("pipeRecap reports whether a recap was produced", async () => {
  const run = (words, signal = new AbortController().signal) =>
    recap.pipeRecap({
      words,
      emit: () => {},
      signal,
      model: MODEL,
      persist: async () => {},
    });
  assert.equal(
    await run((async function* () {
      yield "Done.";
    })()),
    true,
  );
  assert.equal(
    await run((async function* () {
      throw new Error("429");
    })()),
    false,
  );
  assert.equal(await run((async function* () {})()), false);
  assert.equal(
    await run((async function* () {
      yield "   ";
    })()),
    false,
  );
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    await run((async function* () {
      yield "Late.";
    })(), aborted.signal),
    false,
  );
  assert.equal(
    await recap.pipeRecap({
      words: (async function* () {
        yield "Stored or not.";
      })(),
      emit: () => {},
      signal: new AbortController().signal,
      model: MODEL,
      persist: async () => {
        throw new Error("write failed");
      },
    }),
    false,
    "a recap that could not be saved is reported as not written",
  );
});

test("parseSseFrame reads the error frame", () => {
  assert.equal(typeof sse.SSE_ERROR, "string");
  assert.match(sse.SSE_ERROR, /^data: .*\n\n$/);
  assert.deepEqual(sse.parseSseFrame(sse.SSE_ERROR.trim()), { error: true });
  assert.deepEqual(sse.parseSseFrame('data: {"t":"Hi "}'), { word: "Hi " });
});

test("a migration lets only series managers change the stored recap", () => {
  const dir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const name = files.find((f) => {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    return /recap_markdown/.test(s) && /user_can_manage_series/.test(s);
  });
  assert.ok(name, "expected a migration guarding the recap columns");
  assert.ok(
    name > "20261115130000_meeting_recap.sql",
    "the guard is a new migration, never an edit of the recap migration",
  );
  const sql = fs.readFileSync(path.join(dir, name), "utf8");
  for (const column of ["recap_markdown", "recap_generated_at", "recap_model"]) {
    assert.match(
      sql,
      new RegExp(`NEW\\.${column}\\s+IS DISTINCT FROM\\s+OLD\\.${column}`, "i"),
      `${column} changes are checked`,
    );
  }
  assert.match(sql, /NOT\s+public\.user_can_manage_series\(\s*OLD\.series_id\s*\)/i);
  assert.match(sql, /ERRCODE\s*=\s*'42501'/i);
  assert.match(sql, /auth\.role\(\)\s*=\s*'service_role'/i);
  assert.match(sql, /session_user\s+IN\s*\(\s*'postgres'/i);
  assert.match(sql, /SECURITY DEFINER/i);
  assert.match(sql, /SET search_path = public/i);
  assert.match(sql, /BEFORE UPDATE[\s\S]*ON public\.meetings/i);
  assert.match(sql, /FOR EACH ROW EXECUTE FUNCTION public\.enforce_meeting_recap_permissions\(\)/i);
});

test("buildRecapUpdate trims the text and stamps model and time", () => {
  const now = new Date("2026-11-15T10:00:00.000Z");
  assert.deepEqual(recap.buildRecapUpdate("  Hello world.\n", "m-1", now), {
    recap_markdown: "Hello world.",
    recap_generated_at: "2026-11-15T10:00:00.000Z",
    recap_model: "m-1",
  });
});

test("buildRecapUpdate of blank text is null", () => {
  assert.equal(recap.buildRecapUpdate("  \n ", "m-1", new Date()), null);
});

test("buildRecapUpdate stores the sanitized markdown subset", () => {
  const now = new Date("2026-11-15T10:00:00.000Z");
  const row = recap.buildRecapUpdate(
    "Lead.\n\n### Decisions:\n* Ship on Friday.\n\n## Next steps\n1. **Mike Ross:** books it\n",
    "m-1",
    now
  );
  assert.equal(
    row.recap_markdown,
    "Lead.\n\n## Decisions\n- Ship on Friday.\n\n## Next steps\n- **Mike Ross:** books it"
  );
});

test("buildRecapUpdate of marker-only text is null", () => {
  assert.equal(recap.buildRecapUpdate("## \n- \n**", "m-1", new Date()), null);
  assert.equal(recap.buildRecapUpdate("```\n---\n```", "m-1", new Date()), null);
});

test("shouldAutoStartRecap fires only for a manager with a source and no stored recap", () => {
  const base = { canGenerate: true, storedText: null, hasSource: true };
  assert.equal(recap.shouldAutoStartRecap(base), true);
  assert.equal(
    recap.shouldAutoStartRecap({ ...base, storedText: "Stored." }),
    false,
  );
  assert.equal(
    recap.shouldAutoStartRecap({ ...base, storedText: "   " }),
    true,
  );
  assert.equal(
    recap.shouldAutoStartRecap({ ...base, hasSource: false }),
    false,
  );
  assert.equal(
    recap.shouldAutoStartRecap({ ...base, canGenerate: false }),
    false,
  );
});

test("resolveRecapView shows the stored recap first and never an empty section", () => {
  const base = {
    storedText: null,
    streamedText: "",
    streaming: false,
    preparing: false,
    failure: null,
    canGenerate: true,
  };
  assert.equal(
    recap.resolveRecapView({ ...base, storedText: "Stored." }),
    "text",
  );
  assert.equal(
    recap.resolveRecapView({
      ...base,
      storedText: "Stored.",
      canGenerate: false,
    }),
    "text",
    "viewers read the stored recap",
  );
  assert.equal(
    recap.resolveRecapView({ ...base, streamedText: "New." }),
    "text",
  );
  assert.equal(
    recap.resolveRecapView({ ...base, storedText: "Stored.", streaming: true }),
    "streaming",
  );
  assert.equal(
    recap.resolveRecapView({ ...base, preparing: true }),
    "skeleton",
  );
  assert.equal(
    recap.resolveRecapView({ ...base, preparing: true, canGenerate: false }),
    "hidden",
  );
  assert.equal(recap.resolveRecapView({ ...base, failure: "error" }), "failed");
  assert.equal(
    recap.resolveRecapView({ ...base, failure: "error", canGenerate: false }),
    "hidden",
  );
  assert.equal(
    recap.resolveRecapView({ ...base, failure: "unavailable" }),
    "hidden",
  );
  assert.equal(recap.resolveRecapView({ ...base, failure: "stopped" }), "stopped");
  assert.equal(
    recap.resolveRecapView({ ...base, failure: "stopped", canGenerate: false }),
    "hidden",
  );
  assert.equal(recap.resolveRecapView(base), "hidden");
  assert.equal(
    recap.resolveRecapView({ ...base, canGenerate: false }),
    "hidden",
  );
  assert.equal(
    recap.resolveRecapView({
      ...base,
      storedText: "Stored.",
      failure: "error",
    }),
    "text",
    "a failed regenerate keeps the stored recap",
  );
});

test("recapFailureFromStatus treats not-configured and not-entitled as unavailable", () => {
  assert.equal(recap.recapFailureFromStatus(503), "unavailable");
  assert.equal(recap.recapFailureFromStatus(403), "unavailable");
  assert.equal(recap.recapFailureFromStatus(400), "error");
  assert.equal(recap.recapFailureFromStatus(500), "error");
  assert.equal(recap.recapFailureFromStatus(0), "error");
});

test("recapStep maps the pipeline to one active step", () => {
  for (const state of [
    "saving",
    "saved_pending",
    "transcribing",
    "processing_return",
    "waiting_device",
  ]) {
    assert.equal(recap.recapStep(state, false, false), "transcribe", state);
    assert.equal(
      recap.recapStep(state, true, true),
      "transcribe",
      `${state} outranks later steps`,
    );
  }
  assert.equal(recap.recapStep("transcript_ready", true, false), "extract");
  assert.equal(recap.recapStep("transcript_ready", true, true), "extract");
  assert.equal(recap.recapStep("transcript_ready", false, true), "recap");
  assert.equal(recap.recapStep("no_recording", false, true), "recap");
  assert.equal(recap.recapStep("waiting_device_stale", false, true), "recap");
  assert.equal(recap.recapStep("transcript_ready", false, false), null);
  assert.equal(recap.recapStep("no_recording", true, false), null);
  assert.equal(recap.recapStep("extraction_failed", false, false), null);
  assert.equal(recap.recapStep("failed_unknown", false, false), null);
});

test("recapProgressDetail explains the transcribe step", () => {
  assert.equal(
    recap.recapProgressDetail("saving", []),
    "Saving the recording…",
  );
  assert.equal(recap.recapProgressDetail("saved_pending", []), "Preparing…");
  assert.equal(
    recap.recapProgressDetail("transcribing", [
      "2 of 5 parts transcribed",
      "Long recordings can take a few minutes.",
    ]),
    "2 of 5 parts transcribed · Long recordings can take a few minutes.",
  );
  assert.equal(
    recap.recapProgressDetail("processing_return", ["Started 3 minutes ago"]),
    "Started 3 minutes ago",
  );
  assert.equal(recap.recapProgressDetail("processing_return", []), undefined);
  assert.equal(recap.recapProgressDetail("transcript_ready", ["x"]), undefined);
});

test("formatRecapAge renders a short relative time", () => {
  const now = new Date("2026-11-15T12:00:00.000Z");
  assert.equal(
    recap.formatRecapAge("2026-11-15T11:59:40.000Z", now),
    "just now",
  );
  assert.equal(
    recap.formatRecapAge("2026-11-15T11:58:00.000Z", now),
    "2 min ago",
  );
  assert.equal(
    recap.formatRecapAge(new Date("2026-11-15T09:00:00.000Z"), now),
    "3 h ago",
  );
  assert.equal(
    recap.formatRecapAge("2026-11-13T12:00:00.000Z", now),
    "2 d ago",
  );
  assert.equal(recap.formatRecapAge("2026-10-01T12:00:00.000Z", now), "Oct 1");
});
