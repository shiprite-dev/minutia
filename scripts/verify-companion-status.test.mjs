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
const {
  companionRecordStatus,
  COMPANION_ONLINE_MS,
  REQUEST_WINDOW_MS,
  CLAIM_START_MS,
} = await import(pathToFileURL(bundled).href);

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
  recording_seen_at: null,
  recording_failed_reason: null,
};

const base = {
  meeting: live,
  userId: ME,
  checkinAt: ago(5_000),
  legacySeenAt: null,
  isMac: true,
  now: NOW,
};
const status = (over = {}, meeting = {}) =>
  companionRecordStatus({ ...base, ...over, meeting: { ...live, ...meeting } });

const recordingOn = (user, seen = 10_000) => ({
  recording_user_id: user,
  recording_device_name: user === ME ? "Studio Mac" : "Ana's Mac",
  recording_started_at: ago(200_000),
  recording_seen_at: ago(seen),
});

test("the windows match the server's", () => {
  assert.equal(COMPANION_ONLINE_MS, 90_000);
  assert.equal(REQUEST_WINDOW_MS, 30_000);
  assert.equal(CLAIM_START_MS, 20_000);
});

test("a meeting that is not live shows nothing", () => {
  assert.deepEqual(status({}, { status: "completed", ...recordingOn(ME) }), {
    kind: "none",
  });
});

test("a running recording on my Mac names the device", () => {
  assert.deepEqual(status({}, recordingOn(ME)), {
    kind: "recording",
    deviceName: "Studio Mac",
    mine: true,
  });
});

test("someone else's recording is shown to everyone, whatever their own Mac does", () => {
  assert.deepEqual(
    status({ checkinAt: null, isMac: false }, recordingOn("other")),
    { kind: "recording", deviceName: "Ana's Mac", mine: false },
  );
});

test("a recorder that stopped checking in is lost for its owner and gone for everyone else", () => {
  const stale = recordingOn(ME, COMPANION_ONLINE_MS + 1);
  assert.deepEqual(status({}, stale), { kind: "lost" });
  assert.deepEqual(
    status({ userId: "other", checkinAt: null, isMac: false }, stale),
    { kind: "none" },
  );
  assert.deepEqual(status({}, recordingOn("other", COMPANION_ONLINE_MS + 1)), {
    kind: "offer_online",
  });
});

test("my own fresh request is starting, even before the Mac has checked in", () => {
  const request = { record_requested_by: ME, record_requested_at: ago(3_000) };
  assert.deepEqual(status({}, request), { kind: "starting" });
  assert.deepEqual(status({ checkinAt: ago(10 * 60_000) }, request), {
    kind: "starting",
  });
});

test("my claimed Mac is starting until it reports, then lost after 20 s", () => {
  const claimed = (ms) => ({
    recording_user_id: ME,
    recording_device_name: "Studio Mac",
    record_claimed_at: ago(ms),
  });
  assert.deepEqual(status({}, claimed(5_000)), { kind: "starting" });
  assert.deepEqual(status({}, claimed(CLAIM_START_MS + 1)), { kind: "lost" });
});

test("another person's request or claim says nothing about my Mac", () => {
  assert.deepEqual(
    status({}, { record_requested_by: "other", record_requested_at: ago(3_000) }),
    { kind: "offer_online" },
  );
  assert.deepEqual(
    status(
      {},
      {
        recording_user_id: "other",
        recording_device_name: "Ana's Mac",
        record_claimed_at: ago(5_000),
      },
    ),
    { kind: "none" },
  );
});

test("a failure is shown only to the person whose Mac failed", () => {
  const failed = { recording_failed_reason: "mic_denied", record_requested_by: ME };
  assert.deepEqual(status({}, failed), { kind: "failed" });
  assert.deepEqual(status({ userId: "other" }, failed), { kind: "offer_online" });
});

test("recording here instead of on the Mac is not a failure", () => {
  assert.deepEqual(
    status({}, { recording_failed_reason: "in_browser", record_requested_by: ME }),
    { kind: "offer_online" },
  );
});

test("a request nobody picked up within 30 s stops saying starting", () => {
  assert.deepEqual(
    status(
      {},
      {
        record_requested_by: ME,
        record_requested_at: ago(REQUEST_WINDOW_MS + 1),
      },
    ),
    { kind: "offer_online" },
  );
});

test("with no recording, an online Mac is offered from any browser", () => {
  assert.deepEqual(status({ isMac: false }), { kind: "offer_online" });
});

test("a Mac seen before but offline is offered to open, only from a Mac browser", () => {
  const offline = { checkinAt: ago(10 * 60_000) };
  assert.deepEqual(status(offline), { kind: "offer_open" });
  assert.deepEqual(status({ ...offline, isMac: false }), { kind: "none" });
});

test("an older companion that never checks in is offered its record link on a Mac", () => {
  const legacy = { checkinAt: null, legacySeenAt: ago(60_000) };
  assert.deepEqual(status(legacy), { kind: "offer_legacy" });
  assert.deepEqual(status({ ...legacy, isMac: false }), { kind: "none" });
});

test("the install prompt is only for a Mac browser that has never connected a Mac", () => {
  assert.deepEqual(status({ checkinAt: null }), { kind: "install" });
  assert.deepEqual(status({ checkinAt: null, isMac: false }), { kind: "none" });
});
