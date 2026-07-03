"use client";

import * as React from "react";
import { Loader2, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { splitWords, materializeClassName } from "@/lib/summary/flow";
import { parseSseFrame } from "@/lib/summary/sse";

function Word({ text, animate }: { text: string; animate: boolean }) {
  const [className, setClassName] = React.useState(materializeClassName(animate));
  return (
    <span className={className} onAnimationEnd={() => setClassName("")}>
      {text}
    </span>
  );
}

export function FlowingSummary({
  meetingId,
  canGenerate,
  autoStart,
}: {
  meetingId: string;
  canGenerate: boolean;
  autoStart?: boolean;
}) {
  const [text, setText] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const controllerRef = React.useRef<AbortController | null>(null);
  const autoFiredRef = React.useRef(false);

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const stop = React.useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStreaming(false);
  }, []);

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

  const start = React.useCallback(async () => {
    if (streaming) return;
    setText("");
    setDone(false);
    setStreaming(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch(`/api/meetings/${meetingId}/summary/stream`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("stream failed");
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
          if (frame.word) setText((prev) => prev + frame.word);
          if (frame.done) {
            setDone(true);
            setStreaming(false);
            controllerRef.current = null;
            return;
          }
        }
      }
    } catch {
      // Keep whatever text arrived; never gate content behind the animation.
    } finally {
      setStreaming(false);
    }
  }, [meetingId, streaming]);

  // Auto-start the recap once when the parent flips `autoStart` true (recording
  // stopped and the fast-lane recap is ready). Ref-guarded to a single fire.
  React.useEffect(() => {
    if (!autoStart || autoFiredRef.current || !canGenerate || streaming || done) return;
    autoFiredRef.current = true;
    void start();
  }, [autoStart, canGenerate, streaming, done, start]);

  const words = splitWords(text);
  const animate = streaming && !prefersReducedMotion;

  return (
    <section className="mb-8" aria-label="Meeting recap">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-base font-medium text-ink">Recap</h2>
          {streaming && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
              <Sparkles className="size-3.5 animate-pulse" aria-hidden="true" />
              Generating recap
            </span>
          )}
        </div>
        {streaming ? (
          <Button type="button" variant="outline" size="sm" onClick={stop}>
            <Square className="size-3.5" />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={start}
            disabled={!canGenerate}
          >
            {done ? <Loader2 className="size-3.5" /> : <Sparkles className="size-3.5" />}
            {done ? "Regenerate recap" : "Generate recap"}
          </Button>
        )}
      </div>

      {(text || streaming) && (
        <p
          className="font-sans text-sm leading-7 text-ink"
          aria-live="off"
          aria-busy={streaming}
          data-flowing-summary
        >
          {words.map((word) => (
            <Word key={word.key} text={word.text} animate={animate} />
          ))}
        </p>
      )}

      <span className="sr-only" aria-live="polite" aria-atomic="false" aria-relevant="text">
        {done ? "Summary ready" : ""}
      </span>
    </section>
  );
}
