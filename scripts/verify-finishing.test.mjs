import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const bundled = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "minutia-finishing-")),
  "finishing.mjs",
);
await esbuild.build({
  entryPoints: ["src/lib/meetings/finishing.ts"],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  absWorkingDir: root,
});
const { isFinishing, FINISHING_LIMIT_MS } = await import(
  pathToFileURL(bundled).href
);

const waiting = {
  autoRecap: true,
  openedAt: 1_000,
  now: 2_000,
  transcriptRaw: null,
  transcriptionStatus: null,
};

test("a page opened at stop is finishing while the transcript has not landed", () => {
  assert.equal(isFinishing(waiting), true);
  assert.equal(
    isFinishing({ ...waiting, transcriptionStatus: "pending" }),
    true,
  );
  assert.equal(
    isFinishing({ ...waiting, transcriptionStatus: "processing" }),
    true,
  );
  assert.equal(isFinishing({ ...waiting, transcriptRaw: "   " }), true);
});

test("a page opened any other way is never finishing", () => {
  assert.equal(isFinishing({ ...waiting, autoRecap: false }), false);
});

test("finishing ends when the transcript lands, when transcription fails, or after the limit", () => {
  assert.equal(
    isFinishing({
      ...waiting,
      transcriptRaw: "Test User: Ship it.",
      transcriptionStatus: "completed",
    }),
    false,
  );
  assert.equal(
    isFinishing({ ...waiting, transcriptionStatus: "failed" }),
    false,
  );
  assert.equal(
    isFinishing({ ...waiting, transcriptionStatus: "completed" }),
    false,
  );
  assert.equal(FINISHING_LIMIT_MS, 90_000);
  assert.equal(
    isFinishing({ ...waiting, now: waiting.openedAt + FINISHING_LIMIT_MS - 1 }),
    true,
  );
  assert.equal(
    isFinishing({ ...waiting, now: waiting.openedAt + FINISHING_LIMIT_MS }),
    false,
  );
});
