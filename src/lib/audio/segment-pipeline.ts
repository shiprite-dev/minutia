// ---------------------------------------------------------------------------
// Fast-lane segment pipeline sequencer.
//
// Turns the recorder's growing WebM byte stream into independently-decodable
// segment files that upload and transcribe as the meeting runs, so the recap
// can start flowing seconds after "stop". Pure sequencing: every side effect
// (upload, transcribe, status, clock) is injected, so this module is fully
// client-safe and unit-testable with no env, DOM, or Node APIs.
//
// Ordering guarantee: cuts are decided synchronously in push order, then a
// single internal worker drains them one at a time, so seq is strictly
// monotonic and upload/transcribe never interleave across segments. A failed
// upload or transcribe retries once, then abandons that segment while the lane
// keeps running. `flushFinal` cuts the tail from all remaining bytes and lands
// on `ready` only when that final segment uploaded and transcribed.
// ---------------------------------------------------------------------------

import {
  buildSegmentFile,
  cutAtLastClusterStart,
  isSegmentableMime,
  segmentStoragePath,
  shouldCutSegment,
  splitInitSegment,
} from "@/lib/audio/segments";

export type FastLaneState = "off" | "active" | "finalizing" | "ready" | "failed";

export interface SegmentPipelineStatus {
  state: FastLaneState;
  segmentsDone: number;
  segmentsTotal: number;
}

export interface SegmentPipelineDeps {
  upload: (path: string, bytes: Uint8Array) => Promise<void>;
  transcribe: (seq: number, path: string) => Promise<{ ok: boolean; disable?: boolean }>;
  onStatus: (status: SegmentPipelineStatus) => void;
  now?: () => number;
}

export interface SegmentPipeline {
  push(chunk: Uint8Array): Promise<void>;
  flushFinal(): Promise<void>;
  status(): SegmentPipelineStatus;
}

interface SegmentJob {
  seq: number;
  path: string;
  bytes: Uint8Array;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function createSegmentPipeline(
  meetingId: string,
  mimeType: string,
  deps: SegmentPipelineDeps,
): SegmentPipeline {
  const now = deps.now ?? Date.now;

  let state: FastLaneState = isSegmentableMime(mimeType) ? "active" : "off";
  let segmentsDone = 0;
  let segmentsTotal = 0;

  let init: Uint8Array | null = null;
  let buffer: Uint8Array = new Uint8Array(0); // pending cluster bytes once init is known
  let lastCutTime = now();
  let transcribeDisabled = false;
  let finalized = false;
  // Result (uploaded && transcribed) of the highest-seq segment that ran. The
  // worker processes in seq order, so after the last job this reflects the tail.
  let lastSegmentOk = false;

  const queue: SegmentJob[] = [];
  let draining: Promise<void> | null = null;

  function emitStatus(): void {
    deps.onStatus({ state, segmentsDone, segmentsTotal });
  }

  function setState(next: FastLaneState): void {
    if (state === next) return;
    state = next;
    emitStatus();
  }

  async function tryUpload(job: SegmentJob): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await deps.upload(job.path, job.bytes);
        return true;
      } catch {
        // retry once, then give up
      }
    }
    return false;
  }

  async function tryTranscribe(job: SegmentJob): Promise<boolean> {
    if (transcribeDisabled) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      let result: { ok: boolean; disable?: boolean };
      try {
        result = await deps.transcribe(job.seq, job.path);
      } catch {
        result = { ok: false };
      }
      if (result.disable) {
        transcribeDisabled = true;
        return false; // config/gating failure: no text, no further attempts
      }
      if (result.ok) return true;
      // ok:false without disable => retry once
    }
    return false;
  }

  async function runJob(job: SegmentJob): Promise<void> {
    const uploaded = await tryUpload(job);
    const transcribed = uploaded ? await tryTranscribe(job) : false;
    if (uploaded && transcribed) {
      segmentsDone += 1;
      emitStatus();
    }
    lastSegmentOk = uploaded && transcribed;
  }

  function ensureDrain(): Promise<void> {
    if (!draining) {
      draining = (async () => {
        while (queue.length > 0) {
          await runJob(queue.shift() as SegmentJob);
        }
      })().finally(() => {
        draining = null;
      });
    }
    return draining;
  }

  function enqueueSegment(bytes: Uint8Array): void {
    const seq = segmentsTotal;
    segmentsTotal += 1;
    emitStatus();
    queue.push({ seq, path: segmentStoragePath(meetingId, seq), bytes });
    void ensureDrain();
  }

  function maybeCut(): void {
    if (init === null) return;
    if (!shouldCutSegment(buffer.length, now() - lastCutTime)) return;
    const { head, tail } = cutAtLastClusterStart(buffer);
    if (head.length === 0) return; // only a single still-growing cluster
    buffer = tail.slice();
    lastCutTime = now();
    enqueueSegment(buildSegmentFile(init, head));
  }

  async function push(chunk: Uint8Array): Promise<void> {
    if (state === "off" || finalized) return;
    buffer = buffer.length === 0 ? chunk.slice() : concat(buffer, chunk);
    if (init === null) {
      const split = splitInitSegment(buffer);
      if (!split) return; // no cluster yet: keep accumulating
      init = split.init.slice();
      buffer = split.rest.slice();
    }
    maybeCut();
  }

  async function flushFinal(): Promise<void> {
    if (state === "off") return;
    if (finalized) return;
    finalized = true;
    setState("finalizing");

    if (draining) await draining;

    if (init === null) {
      setState("failed"); // no cluster ever seen: nothing to transcribe
      return;
    }

    // Recorder has stopped, so every buffered cluster is complete: cut one
    // final segment from all remaining bytes. Skip only when nothing is pending
    // and an earlier segment already completed (the tail is that last segment).
    if (buffer.length > 0) {
      enqueueSegment(buildSegmentFile(init, buffer));
      buffer = new Uint8Array(0);
      if (draining) await draining;
    }

    if (transcribeDisabled) setState("failed");
    else setState(lastSegmentOk ? "ready" : "failed");
  }

  function status(): SegmentPipelineStatus {
    return { state, segmentsDone, segmentsTotal };
  }

  return { push, flushFinal, status };
}
