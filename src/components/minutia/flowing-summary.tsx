"use client";

import * as React from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownBlocks } from "@/components/minutia/markdown-blocks";
import { parseRecap } from "@/lib/summary/structure";
import { parseSseFrame } from "@/lib/summary/sse";
import {
  formatRecapAge,
  recapFailureFromStatus,
  resolveRecapView,
  type RecapFailure,
} from "@/lib/summary/recap";

export function FlowingSummary({
  meetingId,
  canGenerate,
  initialText,
  generatedAt,
  model,
  autoStart,
  preparing,
  regenerateNonce,
  onStreamingChange,
  onRecapWritten,
}: {
  meetingId: string;
  canGenerate: boolean;
  initialText: string | null;
  generatedAt: Date | string | null;
  model: string | null;
  autoStart?: boolean;
  preparing?: boolean;
  regenerateNonce?: number;
  onStreamingChange?: (streaming: boolean) => void;
  onRecapWritten?: () => void;
}) {
  const [streamedText, setStreamedText] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [streamModel, setStreamModel] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<RecapFailure | null>(null);
  const [finishedAt, setFinishedAt] = React.useState<Date | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);
  const autoFiredRef = React.useRef(false);

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const setStreamingState = React.useCallback(
    (value: boolean) => {
      setStreaming(value);
      onStreamingChange?.(value);
    },
    [onStreamingChange]
  );

  const stop = React.useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStreamingState(false);
    if (!streamedText) setFailure("stopped");
  }, [setStreamingState, streamedText]);

  // An unmount-cleanup abort (StrictMode mounts twice in dev) must not consume
  // the single auto-start; a user-clicked Stop never unmounts, so it stays latched.
  React.useEffect(
    () => () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
        autoFiredRef.current = false;
      }
    },
    []
  );

  const start = React.useCallback(async (overwrite = false) => {
    if (streaming) return;
    setStreamedText("");
    setDone(false);
    setFailure(null);
    setStreamModel(null);
    setStreamingState(true);
    let firstWordSeen = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch(`/api/meetings/${meetingId}/summary/stream${overwrite ? "?regenerate=1" : ""}`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        setFailure(recapFailureFromStatus(response.status));
        return;
      }
      const headerModel = response.headers.get("x-summary-model");
      if (headerModel) setStreamModel(headerModel);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          const frame = parseSseFrame(line);
          if (frame.model) setStreamModel(frame.model);
          if (frame.word) {
            firstWordSeen = true;
            setStreamedText((prev) => prev + frame.word);
          }
          if (frame.error) {
            setStreamedText("");
            setFailure("error");
            return;
          }
          if (frame.done) {
            if (!firstWordSeen) {
              setFailure("error");
              return;
            }
            setDone(true);
            setFinishedAt(new Date());
            setStreamingState(false);
            controllerRef.current = null;
            onRecapWritten?.();
            return;
          }
        }
      }
    } catch {
      if (!controller.signal.aborted && !firstWordSeen) setFailure("error");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setStreamingState(false);
      }
    }
  }, [meetingId, streaming, setStreamingState, onRecapWritten]);

  // Auto-start the recap once when the parent flips `autoStart` true. Ref-guarded
  // to a single fire.
  React.useEffect(() => {
    if (!autoStart || autoFiredRef.current || !canGenerate || streaming || done) return;
    autoFiredRef.current = true;
    void start();
  }, [autoStart, canGenerate, streaming, done, start]);

  // Regenerate: the parent bumps `regenerateNonce` (More actions menu) to re-run
  // the stream. Ignore the initial value.
  const regenerateRef = React.useRef(regenerateNonce);
  React.useEffect(() => {
    if (regenerateNonce === undefined || regenerateNonce === regenerateRef.current) return;
    regenerateRef.current = regenerateNonce;
    if (!canGenerate) return;
    void start(true);
  }, [regenerateNonce, canGenerate, start]);

  const view = resolveRecapView({
    storedText: initialText,
    streamedText,
    streaming,
    preparing: !!preparing,
    failure,
    canGenerate,
  });
  if (view === "hidden") return null;

  const blocks = parseRecap(streamedText || initialText || "", { streaming });
  const animate = streaming && !prefersReducedMotion;
  const writtenAt = finishedAt ?? generatedAt;

  return (
    <section aria-label="Meeting recap" data-recap-section>
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-display text-xl font-semibold text-ink">Recap</h2>
        {view === "streaming" && (
          <span className="font-mono text-xs text-ink-4">Writing recap…</span>
        )}
        <div className="ml-1 flex-1 self-center border-t border-rule" />
        {view === "streaming" && (
          <Button type="button" variant="ghost" size="sm" onClick={stop}>
            <Square className="size-3.5" />
            Stop
          </Button>
        )}
      </div>

      {view === "skeleton" && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[92%]" />
          <Skeleton className="h-4 w-[64%]" />
        </div>
      )}

      {(view === "text" || view === "streaming") && (
        <div
          className="max-w-[65ch] font-sans text-[17px] text-ink-2"
          aria-live="off"
          aria-busy={streaming}
          data-flowing-summary
        >
          <MarkdownBlocks blocks={blocks} animate={animate} />
        </div>
      )}

      {view === "text" && writtenAt && (
        <p
          className="mt-3 font-mono text-[11px] text-ink-4"
          data-recap-provenance
          title={streamModel ?? model ?? undefined}
        >
          Written by AI · {formatRecapAge(writtenAt, new Date())}
        </p>
      )}

      {(view === "failed" || view === "stopped") && (
        <p className="text-sm text-ink-3">
          {view === "failed" ? "The recap could not be written." : "Recap stopped."}{" "}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 text-ink"
            onClick={() => void start()}
          >
            Try again
          </Button>
        </p>
      )}

      <span className="sr-only" aria-live="polite" aria-atomic="false" aria-relevant="text">
        {done ? "Summary ready" : ""}
      </span>
    </section>
  );
}
