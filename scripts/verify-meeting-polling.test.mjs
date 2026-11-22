import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { QueryClient } from "@tanstack/react-query";

const root = process.cwd();
const cacheDir = path.join(root, "node_modules", ".cache");
fs.mkdirSync(cacheDir, { recursive: true });
// Inside the repo so the bundle resolves the externalized react packages.
const tempDir = fs.mkdtempSync(path.join(cacheDir, "minutia-meeting-polling-"));
const stubFile = path.join(tempDir, "supabase-client.mjs");
fs.writeFileSync(
  stubFile,
  `export function createClient() {
  const channel = {
    handlers: [],
    on(_type, filter, handler) { this.handlers.push({ table: filter.table, handler }); return this; },
    subscribe() { return this; },
  };
  return {
    channel() { globalThis.__channels.push(channel); return channel; },
    removeChannel(c) { globalThis.__removed.push(c); return Promise.resolve(); },
  };
}`,
);

const outfile = path.join(tempDir, "use-meetings.mjs");
await esbuild.build({
  entryPoints: ["src/lib/hooks/use-meetings.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  packages: "external",
  plugins: [
    {
      name: "stub-supabase-client",
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({
          path: stubFile,
        }));
      },
    },
  ],
});
const { subscribeMeetingRefresh, meetingKeys } = await import(
  pathToFileURL(outfile).href
);

const typesFile = path.join(tempDir, "types.mjs");
await esbuild.build({
  entryPoints: ["src/lib/types.ts"],
  outfile: typesFile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { MEETING_LIST_COLUMNS, MEETING_DETAIL_COLUMNS } = await import(
  pathToFileURL(typesFile).href
);

const MEETING = "m-1";
const SERIES = "s-1";

function fakeDocument(visibilityState = "visible") {
  const listeners = new Set();
  return {
    visibilityState,
    addEventListener: (type, fn) =>
      type === "visibilitychange" && listeners.add(fn),
    removeEventListener: (type, fn) =>
      type === "visibilitychange" && listeners.delete(fn),
    setVisibility(state) {
      this.visibilityState = state;
      for (const fn of listeners) fn();
    },
    listenerCount: () => listeners.size,
  };
}

function setup({ status, visibility = "visible", transcript = "Transcript", meeting = {} } = {}) {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  globalThis.window = globalThis;
  globalThis.document = fakeDocument(visibility);
  globalThis.__channels = [];
  globalThis.__removed = [];
  const queryClient = new QueryClient();
  if (status)
    queryClient.setQueryData(meetingKeys.detail(MEETING), {
      id: MEETING,
      status,
      ...meeting,
    });
  if (transcript !== undefined)
    queryClient.setQueryData(meetingKeys.transcript(MEETING), {
      transcript_raw: transcript,
      transcript_segments: null,
    });
  const calls = [];
  queryClient.invalidateQueries = (filters) => {
    calls.push(JSON.stringify(filters.queryKey));
    return Promise.resolve();
  };
  const cleanup = subscribeMeetingRefresh(queryClient, MEETING, SERIES);
  const detailRefreshes = () =>
    calls.filter((k) => k === JSON.stringify(meetingKeys.detail(MEETING)))
      .length;
  return { queryClient, calls, cleanup, detailRefreshes };
}

// mock.timers.tick does not fire timers scheduled by a callback within the same
// tick, so advance in small steps like a real clock.
function advance(ms) {
  for (let left = ms; left > 0; left -= Math.min(left, 500)) mock.timers.tick(Math.min(left, 500));
}

test.afterEach(() => mock.timers.reset());

test("a live meeting still refreshes every 2s", () => {
  const { detailRefreshes, cleanup } = setup({ status: "live" });
  advance(10_000);
  assert.equal(detailRefreshes(), 5);
  cleanup();
});

test("a meeting with no cached status keeps the live 2s cadence", () => {
  const { detailRefreshes, cleanup } = setup();
  advance(10_000);
  assert.equal(detailRefreshes(), 5);
  cleanup();
});

test("a completed meeting polls every 30s, not every 2s", () => {
  const { detailRefreshes, cleanup } = setup({ status: "completed" });
  advance(29_999);
  assert.equal(detailRefreshes(), 0);
  advance(1);
  assert.equal(detailRefreshes(), 1);
  advance(30_000);
  assert.equal(detailRefreshes(), 2);
  cleanup();
});

test("a meeting that ends while open drops to the slow cadence", () => {
  const { queryClient, detailRefreshes, cleanup } = setup({ status: "live" });
  advance(2_000);
  assert.equal(detailRefreshes(), 1);
  queryClient.setQueryData(meetingKeys.detail(MEETING), {
    id: MEETING,
    status: "completed",
  });
  advance(2_000);
  assert.equal(detailRefreshes(), 2);
  advance(10_000);
  assert.equal(detailRefreshes(), 2);
  cleanup();
});

test("a just-ended meeting still waiting for its transcript keeps the 2s cadence", () => {
  const { detailRefreshes, cleanup } = setup({
    status: "completed",
    transcript: null,
    meeting: { completed_at: new Date().toISOString() },
  });
  advance(10_000);
  assert.equal(detailRefreshes(), 5);
  cleanup();
});

test("a device recording without a transcript keeps the 2s cadence for the first hour", () => {
  const { detailRefreshes, cleanup } = setup({
    status: "completed",
    transcript: null,
    meeting: {
      completed_at: new Date(Date.now() - 20 * 60_000).toISOString(),
      transcription_provider: "device",
      transcription_status: "failed",
    },
  });
  advance(10_000);
  assert.equal(detailRefreshes(), 5);
  cleanup();
});

test("an old meeting that never had a recording settles to the slow cadence", () => {
  const { detailRefreshes, cleanup } = setup({
    status: "completed",
    transcript: null,
    meeting: { completed_at: new Date(Date.now() - 3 * 3_600_000).toISOString() },
  });
  advance(10_000);
  assert.equal(detailRefreshes(), 0);
  cleanup();
});

const seriesRefreshes = (calls) =>
  calls.filter((k) => k === JSON.stringify(["series", SERIES])).length;

test("an upcoming meeting refreshes the series every 30s so Start meeting turns into Join live meeting", () => {
  const { calls, cleanup } = setup({ status: "upcoming" });
  advance(29_999);
  assert.equal(seriesRefreshes(calls), 0);
  advance(1);
  assert.equal(seriesRefreshes(calls), 1);
  advance(30_000);
  assert.equal(seriesRefreshes(calls), 2);
  cleanup();
});

test("a completed meeting refreshes the series once per 30s, not twice", () => {
  const { calls, cleanup } = setup({ status: "completed" });
  advance(60_000);
  assert.equal(seriesRefreshes(calls), 2);
  cleanup();
});

test("returning to a hidden tab refreshes the series at once, then every 30s", () => {
  const { calls, cleanup } = setup({ status: "upcoming" });
  document.setVisibility("hidden");
  advance(45_000);
  assert.equal(seriesRefreshes(calls), 0);
  document.setVisibility("visible");
  assert.equal(seriesRefreshes(calls), 1);
  advance(30_000);
  assert.equal(seriesRefreshes(calls), 2);
  cleanup();
});

test("a hidden tab never refreshes the series", () => {
  const { calls, cleanup } = setup({ status: "upcoming", visibility: "hidden" });
  advance(90_000);
  assert.equal(seriesRefreshes(calls), 0);
  cleanup();
});

test("a transcript that failed to load is retried by the next tick", () => {
  const { queryClient, calls, cleanup } = setup({ status: "completed" });
  const transcriptKey = JSON.stringify(meetingKeys.transcript(MEETING));
  queryClient
    .getQueryCache()
    .build(queryClient, { queryKey: meetingKeys.transcript(MEETING) })
    .setState({ status: "error", error: new Error("boom") });
  advance(30_000);
  assert.equal(calls.filter((k) => k === transcriptKey).length, 1);
  cleanup();
});

test("a write that settles refreshes the meeting without waiting for the slow tick", async () => {
  const { queryClient, detailRefreshes, cleanup } = setup({ status: "completed" });
  await queryClient
    .getMutationCache()
    .build(queryClient, { mutationFn: () => Promise.resolve("ok") })
    .execute(undefined);
  assert.equal(detailRefreshes(), 1);
  cleanup();
});

test("a hidden tab makes zero poll requests, and returning visible refreshes once", () => {
  const { calls, detailRefreshes, cleanup } = setup({ status: "live" });
  document.setVisibility("hidden");
  advance(20_000);
  assert.equal(calls.length, 0);
  document.setVisibility("visible");
  assert.equal(detailRefreshes(), 1);
  advance(1_999);
  assert.equal(detailRefreshes(), 1);
  advance(1);
  assert.equal(detailRefreshes(), 2);
  cleanup();
});

test("a page opened in a background tab waits for visibility before polling", () => {
  const { calls, detailRefreshes, cleanup } = setup({
    status: "live",
    visibility: "hidden",
  });
  advance(10_000);
  assert.equal(calls.length, 0);
  document.setVisibility("visible");
  assert.equal(detailRefreshes(), 1);
  cleanup();
});

test("a tick refreshes only the meeting, its issues and decisions", () => {
  const { calls, cleanup } = setup({ status: "live" });
  advance(2_000);
  assert.deepEqual(
    new Set(calls),
    new Set([
      JSON.stringify(meetingKeys.detail(MEETING)),
      JSON.stringify(["issues", SERIES]),
      JSON.stringify(["decisions"]),
    ]),
  );
  cleanup();
});

test("a tick never refetches the transcript; a realtime meeting change does", () => {
  const { calls, cleanup } = setup({ status: "live" });
  const transcriptKey = JSON.stringify(meetingKeys.transcript(MEETING));
  advance(10_000);
  assert.equal(calls.filter((k) => k === transcriptKey).length, 0);
  const meetingHandler = globalThis.__channels[0].handlers.find(
    (h) => h.table === "meetings",
  );
  meetingHandler.handler();
  assert.equal(calls.filter((k) => k === transcriptKey).length, 1);
  cleanup();
});

test("a meeting row change while hidden refetches the transcript once on return", () => {
  const { calls, cleanup } = setup({ status: "live" });
  const transcriptKey = JSON.stringify(meetingKeys.transcript(MEETING));
  const meetingHandler = globalThis.__channels[0].handlers.find((h) => h.table === "meetings");
  document.setVisibility("hidden");
  meetingHandler.handler();
  assert.equal(calls.length, 0);
  document.setVisibility("visible");
  assert.equal(calls.filter((k) => k === transcriptKey).length, 1);
  document.setVisibility("hidden");
  document.setVisibility("visible");
  assert.equal(calls.filter((k) => k === transcriptKey).length, 1);
  cleanup();
});

test("a tick is skipped while a mutation is in flight", () => {
  const { queryClient, calls, cleanup } = setup({ status: "live" });
  queryClient.isMutating = () => 1;
  advance(4_000);
  assert.equal(calls.length, 0);
  cleanup();
});

test("cleanup stops the poll, the visibility listener and the channel", () => {
  const { calls, cleanup } = setup({ status: "live" });
  cleanup();
  advance(60_000);
  assert.equal(calls.length, 0);
  assert.equal(document.listenerCount(), 0);
  assert.equal(globalThis.__removed.length, 1);
});

const HEAVY = [
  "transcript_raw",
  "transcript_segments",
  "transcription_source",
  "notes_markdown",
  "raw_notes_markdown",
  "companion_notes_markdown",
  "ai_notes_markdown",
  "recap_markdown",
];
const cols = (s) => s.split(",").map((c) => c.trim());

test("list columns leave out transcripts and large text", () => {
  for (const heavy of HEAVY)
    assert.ok(!cols(MEETING_LIST_COLUMNS).includes(heavy), heavy);
  for (const needed of [
    "id",
    "series_id",
    "title",
    "date",
    "status",
    "sequence_number",
    "transcription_status",
  ]) {
    assert.ok(cols(MEETING_LIST_COLUMNS).includes(needed), needed);
  }
});

test("the polled detail query never carries the transcript", () => {
  const detail = cols(MEETING_DETAIL_COLUMNS);
  assert.ok(!detail.includes("transcript_raw"));
  assert.ok(!detail.includes("transcript_segments"));
  for (const needed of [
    "notes_markdown",
    "recap_markdown",
    "companion_notes_markdown",
    "speaker_map",
    "transcript_diarized",
  ]) {
    assert.ok(detail.includes(needed), needed);
  }
});
