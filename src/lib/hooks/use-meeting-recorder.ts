"use client";

import * as React from "react";
import type { RecordingState } from "@/lib/types";
import { appendAudioChunk } from "@/lib/offline-buffer";
import {
  audioContentType,
  isRecordingSupported,
  MEETING_AUDIO_BUCKET,
  micErrorMessage,
  pickAudioMimeType,
} from "@/lib/audio";
import {
  createSegmentPipeline,
  type SegmentPipeline,
  type SegmentPipelineStatus,
} from "@/lib/audio/segment-pipeline";
import { createClient } from "@/lib/supabase/client";

export interface AudioRecordingResult {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}

export interface MeetingRecorder {
  state: RecordingState;
  durationSeconds: number;
  isSupported: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<AudioRecordingResult | null>;
  pause: () => void;
  resume: () => void;
  fastLane: SegmentPipelineStatus;
  /**
   * Resolve once the fast lane reaches a terminal state ("ready" | "failed" |
   * "off"), or with the current status after `timeoutMs`. Resolves immediately
   * when already terminal. Lets the final transcribe wait for the tail segment
   * to register before it decides whether to trust the segment rows.
   */
  waitForFastLane: (timeoutMs: number) => Promise<SegmentPipelineStatus>;
}

const FAST_LANE_OFF: SegmentPipelineStatus = {
  state: "off",
  segmentsDone: 0,
  segmentsTotal: 0,
};

const TICK_MS = 500;

/** The fast lane has settled: its segment rows will not change further. */
function isTerminalFastLane(status: SegmentPipelineStatus): boolean {
  return status.state === "ready" || status.state === "failed" || status.state === "off";
}

/**
 * wraps MediaRecorder for live meeting capture.
 *
 * Chunks are streamed to IndexedDB as they arrive (crash recovery) and also
 * held in memory for assembly on stop. The duration is computed from real
 * timestamps so pausing does not inflate it. Unsupported browsers report
 * `isSupported = false` so the UI can degrade gracefully.
 */
export function useMeetingRecorder(meetingId: string): MeetingRecorder {
  const [state, setState] = React.useState<RecordingState>("idle");
  const [durationSeconds, setDurationSeconds] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [isSupported, setIsSupported] = React.useState(true);
  const [fastLane, setFastLane] = React.useState<SegmentPipelineStatus>(FAST_LANE_OFF);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const mountedRef = React.useRef(true);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const seqRef = React.useRef(0);
  const mimeRef = React.useRef<string>("audio/webm");
  const pipelineRef = React.useRef<SegmentPipeline | null>(null);
  const fastLaneRef = React.useRef<SegmentPipelineStatus>(FAST_LANE_OFF);
  const fastLaneWaitersRef = React.useRef<Array<(status: SegmentPipelineStatus) => void>>([]);
  // Serializes async Blob->Uint8Array conversion so the pipeline sees chunks in
  // capture order regardless of arrayBuffer() resolution timing.
  const pushChainRef = React.useRef<Promise<void>>(Promise.resolve());
  const tickRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = React.useRef(0); // seconds accumulated across segments
  const segmentStartRef = React.useRef(0); // ms timestamp of current segment

  React.useEffect(() => {
    setIsSupported(isRecordingSupported());
  }, []);

  const stopTicking = React.useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const startTicking = React.useCallback(() => {
    stopTicking();
    segmentStartRef.current = Date.now();
    tickRef.current = setInterval(() => {
      const live = (Date.now() - segmentStartRef.current) / 1000;
      setDurationSeconds(elapsedRef.current + live);
    }, TICK_MS);
  }, [stopTicking]);

  const accrueElapsed = React.useCallback(() => {
    if (segmentStartRef.current) {
      elapsedRef.current += (Date.now() - segmentStartRef.current) / 1000;
      segmentStartRef.current = 0;
    }
  }, []);

  const teardownStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = React.useCallback(async () => {
    setError(null);
    if (!isRecordingSupported()) {
      setIsSupported(false);
      setError("Recording is not supported in this browser.");
      return;
    }
    const mimeType = pickAudioMimeType();
    if (!mimeType) {
      setIsSupported(false);
      setError("This browser cannot record audio.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(micErrorMessage(err));
      setState("idle");
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    seqRef.current = 0;
    elapsedRef.current = 0;
    mimeRef.current = mimeType;
    pushChainRef.current = Promise.resolve();
    setDurationSeconds(0);

    const recorder = new MediaRecorder(stream, { mimeType });

    // Fast lane: cut, upload, and transcribe WebM segments as the meeting runs
    // so the recap can flow seconds after stop. Non-webm mimes degrade to `off`.
    // Pipeline failures never break capture (all interaction runs through the
    // push chain's catch or the pipeline's own retry/abandon logic).
    const supabase = createClient();
    const contentType = audioContentType(mimeType);
    const pipeline = createSegmentPipeline(meetingId, mimeType, {
      upload: async (path, bytes) => {
        const { error: uploadError } = await supabase.storage
          .from(MEETING_AUDIO_BUCKET)
          .upload(path, new Blob([bytes as BlobPart], { type: contentType }), {
            contentType,
            upsert: true,
          });
        if (uploadError) throw uploadError;
      },
      transcribe: async (seq, path) => {
        const res = await fetch(
          `/api/meetings/${meetingId}/segments/${seq}/transcribe`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path }),
          }
        );
        return {
          ok: res.ok,
          disable: res.status === 503 || res.status === 402 || res.status === 403,
        };
      },
      onStatus: (status) => {
        fastLaneRef.current = status;
        if (mountedRef.current) setFastLane(status);
        if (isTerminalFastLane(status)) {
          const waiters = fastLaneWaitersRef.current;
          fastLaneWaitersRef.current = [];
          waiters.forEach((resolve) => resolve(status));
        }
      },
    });
    pipelineRef.current = pipeline;
    fastLaneRef.current = pipeline.status();
    setFastLane(pipeline.status());

    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      chunksRef.current.push(event.data);
      // Persist for crash recovery; never let a buffer write break capture.
      void appendAudioChunk(meetingId, seqRef.current++, event.data).catch(
        () => undefined
      );
      // Feed the fast lane in strict capture order: chain the async
      // Blob->Uint8Array conversion so pushes never reorder or block capture.
      const data = event.data;
      pushChainRef.current = pushChainRef.current
        .then(async () => {
          const bytes = new Uint8Array(await data.arrayBuffer());
          await pipeline.push(bytes);
        })
        .catch(() => undefined);
    };
    recorderRef.current = recorder;
    recorder.start(1000); // 1s timeslice -> steady IndexedDB flushes
    startTicking();
    setState("recording");
  }, [meetingId, startTicking]);

  const pause = React.useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    accrueElapsed();
    stopTicking();
    setState("paused");
  }, [accrueElapsed, stopTicking]);

  const resume = React.useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    startTicking();
    setState("recording");
  }, [startTicking]);

  const stop = React.useCallback((): Promise<AudioRecordingResult | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return Promise.resolve(null);
    }
    accrueElapsed();
    stopTicking();

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const mimeType = mimeRef.current;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const durationSeconds = elapsedRef.current;
        teardownStream();
        recorderRef.current = null;
        if (mountedRef.current) {
          setState("stopped");
          setDurationSeconds(durationSeconds);
        }
        // Fire-and-forget: after the tail chunk has been pushed (chain drains),
        // cut the final segment. Never delays the blob resolution below.
        const pipeline = pipelineRef.current;
        pipelineRef.current = null;
        void pushChainRef.current
          .then(() => pipeline?.flushFinal())
          .catch(() => undefined);
        resolve(
          blob.size > 0 ? { blob, mimeType, durationSeconds } : null
        );
      };
      recorder.stop();
    });
  }, [accrueElapsed, stopTicking, teardownStream]);

  const waitForFastLane = React.useCallback(
    (timeoutMs: number): Promise<SegmentPipelineStatus> => {
      const current = fastLaneRef.current;
      if (isTerminalFastLane(current)) return Promise.resolve(current);
      return new Promise((resolve) => {
        let settled = false;
        const waiter = (status: SegmentPipelineStatus) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(status);
        };
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          fastLaneWaitersRef.current = fastLaneWaitersRef.current.filter((w) => w !== waiter);
          resolve(fastLaneRef.current);
        }, timeoutMs);
        fastLaneWaitersRef.current.push(waiter);
      });
    },
    []
  );

  // Cleanup on unmount: stop the mic, never leave a hot stream behind, and
  // suppress any in-flight onstop setState now that we are unmounting.
  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      stopTicking();
      try {
        recorderRef.current?.stop();
      } catch {
        // recorder may already be inactive
      }
      teardownStream();
    };
  }, [stopTicking, teardownStream]);

  return {
    state,
    durationSeconds,
    isSupported,
    error,
    start,
    stop,
    pause,
    resume,
    fastLane,
    waitForFastLane,
  };
}
