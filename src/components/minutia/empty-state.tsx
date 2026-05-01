"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface EmptyStateProps {
  variant: "no-series" | "no-issues" | "no-actions";
  onAction?: () => void;
}

const config: Record<
  EmptyStateProps["variant"],
  { message: string; cta?: string }
> = {
  "no-series": {
    message: "Every good log starts with one meeting.",
    cta: "Create your first series",
  },
  "no-issues": {
    message: "Nothing outstanding. Enjoy the quiet.",
  },
  "no-actions": {
    message: "You owe nobody anything right now. Keep it that way.",
  },
};

function NoSeriesGlyph() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-ink-4 mb-4"
      aria-hidden="true"
    >
      {/* Spreadsheet grid (crossed out) */}
      <rect x="8" y="8" width="32" height="32" rx="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.4" />
      <line x1="8" y1="18" x2="40" y2="18" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <line x1="8" y1="28" x2="40" y2="28" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <line x1="20" y1="8" x2="20" y2="40" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <line x1="32" y1="8" x2="32" y2="40" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      {/* Diagonal strike */}
      <line x1="10" y1="10" x2="38" y2="38" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      {/* Flame */}
      <path
        d="M34 14c0 4-3 7-3 7s-1-2-1-4c0 3-2.5 6-2.5 6S26 20 26 17c0 4-3 8-3 8"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
    </svg>
  );
}

function QuietDashes() {
  return (
    <div className="flex items-center gap-1.5 mb-3" aria-hidden="true">
      {Array.from({ length: 7 }).map((_, i) => (
        <span
          key={i}
          className="inline-block h-px bg-ink-4/30"
          style={{ width: `${12 + Math.sin(i * 1.2) * 6}px` }}
        />
      ))}
    </div>
  );
}

export function EmptyState({ variant, onAction }: EmptyStateProps) {
  const { message, cta } = config[variant];

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {variant === "no-series" && <NoSeriesGlyph />}
      {variant === "no-issues" && <QuietDashes />}

      <p
        className={cn(
          "text-ink-2 max-w-sm",
          variant === "no-issues" ? "text-[13px]" : "text-sm"
        )}
      >
        {message}
      </p>

      {cta && onAction && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAction}
          className="mt-4 text-accent hover:text-accent-hover gap-1"
        >
          {cta}
          <ArrowRight className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
