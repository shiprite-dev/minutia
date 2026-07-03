"use client";

import * as React from "react";
import { Check, Loader2, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { splitWords, materializeClassName, formatProvenance } from "@/lib/summary/flow";
import { parseSseFrame } from "@/lib/summary/sse";

function Word({ text, bold, animate }: { text: string; bold: boolean; animate: boolean }) {
  const [className, setClassName] = React.useState(materializeClassName(animate));
  const props = {
    className: cn(className, bold && "font-semibold text-ink"),
    onAnimationEnd: () => setClassName(""),
  };
  return bold ? <strong {...props}>{text}</strong> : <span {...props}>{text}</span>;
}

export function FlowingSummary({
  meetingId,
  canGenerate,
  autoStart,
  preparing,
  replayNonce,
}: {
  meetingId: string;
  canGenerate: boolean;
  autoStart?: boolean;
  preparing?: boolean;
  replayNonce?: number;
}) {
  const [text, setText] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [model, setModel] = React.useState<string | null>(null);
  const [firstWordMs, setFirstWordMs] = React.useState<number | null>(null);
  const [totalMs, setTotalMs] = React.useState<number | null>(null);
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
    setModel(null);
    setFirstWordMs(null);
    setTotalMs(null);
    setStreaming(true);
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let firstWordSeen = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch(`/api/meetings/${meetingId}/summary/stream`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("stream failed");
      const headerModel = response.headers.get("x-summary-model");
      if (headerModel) setModel(headerModel);
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
          if (frame.model) setModel(frame.model);
          if (frame.word) {
            if (!firstWordSeen) {
              firstWordSeen = true;
              const now =
                typeof performance !== "undefined" ? performance.now() : Date.now();
              setFirstWordMs(now - startedAt);
            }
            setText((prev) => prev + frame.word);
          }
          if (frame.done) {
            const now =
              typeof performance !== "undefined" ? performance.now() : Date.now();
            setTotalMs(now - startedAt);
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

  // Replay: the parent bumps `replayNonce` (footer button or the R shortcut) to
  // re-run the stream. Ignore the initial value and any change while streaming.
  const replayRef = React.useRef(replayNonce);
  React.useEffect(() => {
    if (replayNonce === undefined || replayNonce === replayRef.current) return;
    replayRef.current = replayNonce;
    if (!canGenerate) return;
    void start();
  }, [replayNonce, canGenerate, start]);

  const words = splitWords(text);
  const animate = streaming && !prefersReducedMotion;
  const showPreparing = !!preparing && !streaming && !done && !text;
  const provenance = formatProvenance({ firstWordMs, totalMs });

  return (
    <section className="mb-10" aria-label="Meeting recap" data-recap-section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-3">
            Recap
          </h2>
          {streaming && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
              <Sparkles className="size-3.5 animate-pulse" aria-hidden="true" />
              Generating recap
            </span>
          )}
          {showPreparing && (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-ink-3"
              role="status"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Wrapping up the recap...
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
            disabled={!canGenerate || showPreparing}
          >
            {done ? <Loader2 className="size-3.5" /> : <Sparkles className="size-3.5" />}
            {done ? "Regenerate recap" : "Generate recap"}
          </Button>
        )}
      </div>

      {(text || streaming) && (
        <p
          className="font-sans text-[15px] leading-8 text-ink-2"
          aria-live="off"
          aria-busy={streaming}
          data-flowing-summary
        >
          {words.map((word) => (
            <Word key={word.key} text={word.text} bold={word.bold} animate={animate} />
          ))}
        </p>
      )}

      {done && (
        <p
          className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[11px] text-ink-4"
          data-recap-provenance
        >
          <Check className="size-3 text-success" aria-hidden="true" />
          <span className="text-ink-3">Summary ready</span>
          {model && (
            <>
              <span aria-hidden="true">·</span>
              <span>{model}</span>
            </>
          )}
          {provenance && (
            <>
              <span aria-hidden="true">·</span>
              <span>{provenance}</span>
            </>
          )}
        </p>
      )}

      <span className="sr-only" aria-live="polite" aria-atomic="false" aria-relevant="text">
        {done ? "Summary ready" : ""}
      </span>
    </section>
  );
}
