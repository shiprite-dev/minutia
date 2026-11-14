import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

// The status region's copy is a contract, so it is asserted exhaustively here
// rather than sampled through one browser scenario. resolveTranscriptionView is
// pure: state plus a few facts in, title/details/actions out.

const root = process.cwd();
// Keep the bundle inside the repo so its bare imports (react, lucide) resolve
// against node_modules instead of a temp directory with no package graph.
const outDir = path.join(root, "node_modules", ".cache", "minutia-status-copy");
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, `run-${process.pid}.mjs`);

await esbuild.build({
  entryPoints: ["src/components/minutia/transcription-status.tsx"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
  jsx: "automatic",
  external: ["react", "react-dom", "lucide-react", "sonner", "class-variance-authority"],
  loader: { ".css": "empty", ".svg": "empty", ".png": "empty" },
});

const { resolveTranscriptionView } = await import(pathToFileURL(outfile).href);

const noop = () => {};
const base = {
  partsDone: 0,
  partsTotal: 0,
  elapsedSeconds: undefined,
  startedMinutesAgo: null,
  reason: null,
  canDownloadAudio: false,
  onStop: noop,
  onPause: noop,
  onResume: noop,
  onRetryMicrophone: noop,
  onRetryTranscription: noop,
  onDownloadAudio: noop,
  onRetryActionItems: noop,
  onAddNotes: noop,
  onEditTranscript: noop,
  onReviewActionItems: noop,
  onViewStatus: noop,
  onRefreshStatus: noop,
  onRetryUpload: noop,
  onBackToSeries: noop,
  onContactAdmin: noop,
  onSignIn: noop,
};

function view(state, overrides = {}) {
  return resolveTranscriptionView({ ...base, state, ...overrides });
}

// Every state carries an exact title. A changed string here is a copy change the
// user will see, so it must be deliberate.
const TITLES = {
  recording: "Recording…",
  paused: "Recording paused.",
  mic_denied: null, // message comes from the recorder, asserted separately
  saving: "Saving your recording… Keep this page open until it is saved.",
  saved_pending: "Recording saved. Preparing transcription…",
  transcribing: "Transcribing…",
  transcribing_stale: "Transcription is taking longer than expected.",
  processing_return: "Still transcribing this recording…",
  transcript_ready: "Transcript ready. Check action items below.",
  extraction_failed: "Your transcript is ready, but action items could not be created.",
  no_speech: "No speech detected in this recording.",
  empty_unknown: "No transcript is available for this recording.",
  no_recording: "No recording or transcript is available for this meeting.",
  failed_unknown: "Transcription did not finish.",
  needs_admin: "This workspace has not been set up for transcription yet. Ask your administrator.",
  needs_signin: "Your session expired. Please sign in again.",
  already_running: "This recording is already being transcribed.",
  input_mismatch: "This recording changed. Refresh to see its current status.",
  buffered_local: "Recording saved on this device. Reopen this meeting on this device to upload it.",
  buffered_failed: "Your recording could not be saved on this device. Keep this page open and retry saving.",
  deleted: "This meeting was deleted or is no longer available.",
};

for (const [state, title] of Object.entries(TITLES)) {
  test(`${state} renders its exact title`, () => {
    const v = view(state, { reason: "Transcription took too long. Try again." });
    if (title === null) {
      assert.ok(v.title.length > 0, "mic_denied must render the recorder's message");
      return;
    }
    assert.equal(v.title, title);
  });
}

test("active states carry exactly one primary action, passive states carry none", () => {
  const actionable = {
    recording: "Stop",
    paused: "Resume",
    transcribing_stale: "Retry transcription",
    transcript_ready: "Review action items",
    extraction_failed: "Retry action items",
    no_speech: "Add notes",
    empty_unknown: "Add notes",
    no_recording: "Add notes",
    failed: "Retry transcription",
    failed_unknown: "Retry transcription",
    needs_admin: "Contact administrator",
    needs_signin: "Sign in",
    already_running: "View status",
    input_mismatch: "Refresh status",
    buffered_local: "Retry upload",
    buffered_failed: "Retry saving",
    deleted: "Back to series",
  };
  for (const [state, label] of Object.entries(actionable)) {
    const v = view(state, { reason: "Transcription took too long. Try again.", canDownloadAudio: true });
    assert.ok(v.primary, `${state} must have a primary action`);
    assert.equal(v.primary.label, label, `${state} primary label`);
  }

  for (const state of ["saving", "saved_pending", "transcribing", "processing_return"]) {
    const v = view(state);
    assert.equal(v.primary, undefined, `${state} is passive and must not offer an action`);
  }
});

test("passive states tell the user no action is needed", () => {
  for (const state of ["saving", "saved_pending", "transcribing", "processing_return"]) {
    const v = view(state);
    const text = [v.title, ...v.details].join(" ").toLowerCase();
    assert.match(
      text,
      /keep this page open|preparing|still transcribing|transcribing|take a few minutes|no action/,
      `${state} must explain what is happening`
    );
  }
});

test("download audio is offered only when a recording is retrievable", () => {
  assert.equal(view("failed", { reason: "x", canDownloadAudio: false }).secondary, undefined);
  const withAudio = view("failed", { reason: "x", canDownloadAudio: true });
  assert.equal(withAudio.secondary?.label, "Download audio");
  // Never after confirmed deletion.
  assert.equal(view("no_recording", { canDownloadAudio: true }).secondary, undefined);
});

test("the long-running hint appears at 60 seconds, not before", () => {
  const early = view("transcribing", { elapsedSeconds: 59 });
  const late = view("transcribing", { elapsedSeconds: 60 });
  const hint = /Long recordings can take a few minutes/;
  assert.ok(!hint.test([early.title, ...early.details].join(" ")));
  assert.ok(hint.test([late.title, ...late.details].join(" ")));
});

test("part counts appear only when a total is known", () => {
  const unknownTotal = view("transcribing", { partsDone: 3, partsTotal: 0 });
  assert.ok(!unknownTotal.details.some((d) => d.includes("of ") && d.includes("parts")));
  const knownTotal = view("transcribing", { partsDone: 3, partsTotal: 7 });
  assert.ok(
    knownTotal.details.some((d) => d.includes("3") && d.includes("7")),
    "a known total must be shown as N of M"
  );
});

test("elapsed copy is omitted when the start time is unknown", () => {
  const v = view("processing_return", { startedMinutesAgo: null });
  assert.ok(!v.details.some((d) => /minute/i.test(d)), "no fabricated elapsed time");
});

test("failures are alerts and progress is polite status", () => {
  for (const state of ["failed", "failed_unknown", "deleted"]) {
    assert.equal(view(state, { reason: "x" }).alert, true, `${state} must be an alert`);
  }
  // Absence is information, not an error: a quiet meeting must not shout.
  for (const state of ["no_speech", "empty_unknown", "no_recording"]) {
    assert.equal(view(state).alert, false, `${state} must be a polite status, not an alert`);
  }
  for (const state of ["recording", "transcribing", "processing_return", "saving"]) {
    assert.equal(view(state).alert, false, `${state} must be polite status`);
  }
});
