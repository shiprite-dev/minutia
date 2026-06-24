"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Square, Pause, Play, Loader2 } from "lucide-react";
import type { RecordingState } from "@/lib/types";
import { formatRecordingDuration } from "@/lib/audio";
import { cn } from "@/lib/utils";

interface RecordingIndicatorProps {
  state: RecordingState;
  durationSeconds: number;
  isSupported: boolean;
  error?: string | null;
  uploading?: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

/**
 * live capture recording control. Idle shows a Record button; while
 * recording it shows a pulsing dot, a monospaced timer, and pause/stop. Falls
 * back to a quiet note when the browser cannot capture audio.
 */
export function RecordingIndicator({
  state,
  durationSeconds,
  isSupported,
  error,
  uploading,
  onStart,
  onStop,
  onPause,
  onResume,
}: RecordingIndicatorProps) {
  if (!isSupported) {
    return (
      <p className="text-[11px] font-mono text-ink-4" role="note">
        Recording not supported in this browser
      </p>
    );
  }

  if (uploading) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-ink-3">
        <Loader2 className="size-3.5 animate-spin" />
        Saving recording...
      </span>
    );
  }

  const isActive = state === "recording" || state === "paused";

  return (
    <div className="inline-flex items-center gap-3">
      {error && (
        <span className="text-[11px] text-warn" role="alert">
          {error}
        </span>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {!isActive ? (
          <motion.button
            key="record"
            type="button"
            onClick={onStart}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            aria-label="Record meeting audio"
            className="inline-flex items-center gap-2 rounded-full border border-rule bg-card px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-rule-strong hover:bg-paper-2"
          >
            <Mic className="size-3.5 text-red-500" />
            Record
          </motion.button>
        ) : (
          <motion.div
            key="recording"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5"
          >
            <span className="relative inline-flex size-2.5 items-center justify-center">
              {state === "recording" && (
                <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-red-500/60" />
              )}
              <span
                className={cn(
                  "relative inline-flex size-2 rounded-full",
                  state === "recording" ? "bg-red-500" : "bg-ink-4"
                )}
              />
            </span>

            <span
              aria-label="Recording time"
              className="text-xs font-mono tabular-nums text-ink"
            >
              {formatRecordingDuration(durationSeconds)}
            </span>

            {state === "recording" && onPause && (
              <button
                type="button"
                onClick={onPause}
                aria-label="Pause recording"
                className="text-ink-3 transition-colors hover:text-ink"
              >
                <Pause className="size-3.5" />
              </button>
            )}
            {state === "paused" && onResume && (
              <button
                type="button"
                onClick={onResume}
                aria-label="Resume recording"
                className="text-ink-3 transition-colors hover:text-ink"
              >
                <Play className="size-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onStop}
              aria-label="Stop recording"
              className="text-red-500 transition-colors hover:text-red-600"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
