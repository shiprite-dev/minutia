"use client";

import * as React from "react";
import type { RecordingState } from "@/lib/types";
import { appendAudioChunk } from "@/lib/offline-buffer";
import { isRecordingSupported, pickAudioMimeType } from "@/lib/audio";

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
}

const TICK_MS = 500;

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

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const mountedRef = React.useRef(true);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const seqRef = React.useRef(0);
  const mimeRef = React.useRef<string>("audio/webm");
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
    } catch {
      setError("Microphone access was denied.");
      setState("idle");
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    seqRef.current = 0;
    elapsedRef.current = 0;
    mimeRef.current = mimeType;
    setDurationSeconds(0);

    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      chunksRef.current.push(event.data);
      // Persist for crash recovery; never let a buffer write break capture.
      void appendAudioChunk(meetingId, seqRef.current++, event.data).catch(
        () => undefined
      );
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
        resolve(
          blob.size > 0 ? { blob, mimeType, durationSeconds } : null
        );
      };
      recorder.stop();
    });
  }, [accrueElapsed, stopTicking, teardownStream]);

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
  };
}
