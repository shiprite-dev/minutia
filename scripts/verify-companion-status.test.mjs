import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const bundled = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "minutia-companion-status-")),
  "status.mjs",
);
await esbuild.build({
  entryPoints: ["src/lib/companion/status.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { companionRecordStatus, COMPANION_ONLINE_MS } = await import(
  pathToFileURL(bundled).href
);

const NOW = Date.parse("2026-11-16T10:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const ME = "user-me";

const live = {
  status: "live",
  record_requested_at: null,
  record_requested_by: null,
  recording_user_id: null,
  recording_device_name: null,
  record_claimed_at: null,
  recording_started_at: null,
  recording_failed_reason: null,
};

const base = {
  meeting: live,
  userId: ME,
  lastSeenAt: ago(5_000),
  isMac: true,
  now: NOW,
};
const status = (over = {}, meeting = {}) =>
  companionRecordStatus({ ...base, ...over, meeting: { ...live, ...meeting } });

test("a Mac seen in the last 90 s is online", () => {
  assert.equal(COMPANION_ONLINE_MS, 90_000);
});

test("a meeting that is not live shows nothing", () => {
  assert.deepEqual(
    status(
      {},
      {
        status: "completed",
        recording_started_at: ago(1_000),
        recording_user_id: ME,
      },
    ),
    { kind: "none" },
  );
});

test("a running recording on my Mac names the device", () => {
  assert.deepEqual(
    status(
      {},
      {
        recording_user_id: ME,
        recording_device_name: "Studio Mac",
        recording_started_at: ago(30_000),
      },
    ),
    { kind: "recording", deviceName: "Studio Mac", mine: true },
  );
});

test("someone else's recording is shown to everyone, whatever their own Mac does", () => {
  assert.deepEqual(
    status(
      { lastSeenAt: null, isMac: false },
      {
        recording_user_id: "other",
        recording_device_name: "Ana's Mac",
        recording_started_at: ago(30_000),
      },
    ),
    { kind: "recording", deviceName: "Ana's Mac", mine: false },
  );
});

test("my recording is lost when my Mac stops checking in", () => {
  assert.deepEqual(
    status(
      { lastSeenAt: ago(COMPANION_ONLINE_MS + 1) },
      {
        recording_user_id: ME,
        recording_device_name: "Studio Mac",
        recording_started_at: ago(200_000),
      },
    ),
    { kind: "lost" },
  );
});

test("a fresh request to an online Mac is starting, and so is a claim that has not started yet", () => {
  assert.deepEqual(
    status({}, { record_requested_by: ME, record_requested_at: ago(3_000) }),
    { kind: "starting" },
  );
  assert.deepEqual(
    status(
      {},
      {
        recording_user_id: ME,
        recording_device_name: "Studio Mac",
        record_claimed_at: ago(5_000),
      },
    ),
    { kind: "starting" },
  );
});

test("a claim that never started within 20 s is lost", () => {
  assert.deepEqual(
    status(
      {},
      {
        recording_user_id: ME,
        recording_device_name: "Studio Mac",
        record_claimed_at: ago(20_001),
      },
    ),
    { kind: "lost" },
  );
});

test("a Mac that reported it could not start falls back", () => {
  assert.deepEqual(status({}, { recording_failed_reason: "mic_denied" }), {
    kind: "failed",
  });
});

test("a request nobody picked up within 10 s stops saying starting", () => {
  assert.deepEqual(
    status({}, { record_requested_by: ME, record_requested_at: ago(10_001) }),
    { kind: "offer_online" },
  );
});

test("with no recording, an online Mac is offered from any browser", () => {
  assert.deepEqual(status({ isMac: false }), { kind: "offer_online" });
});

test("a Mac seen before but offline is offered to open, only from a Mac browser", () => {
  const offline = { lastSeenAt: ago(10 * 60_000) };
  assert.deepEqual(status(offline), { kind: "offer_open" });
  assert.deepEqual(status({ ...offline, isMac: false }), { kind: "none" });
});

test("the install prompt is only for a Mac browser that has never connected a Mac", () => {
  assert.deepEqual(status({ lastSeenAt: null }), { kind: "install" });
  assert.deepEqual(status({ lastSeenAt: null, isMac: false }), {
    kind: "none",
  });
});
