"use client";

import { cn } from "@/lib/utils";
import type { Priority } from "@/lib/types";

interface PriorityIndicatorProps {
  priority: Priority;
}

const priorityColorMap: Record<Priority, string> = {
  critical: "bg-accent",
  high: "bg-ink",
  medium: "bg-ink-3",
  low: "bg-ink-4",
};

const priorityLabelMap: Record<Priority, string | null> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: null,
  low: null,
};

export function PriorityIndicator({ priority }: PriorityIndicatorProps) {
  const label = priorityLabelMap[priority];

  return (
    <span
      className="inline-flex items-center gap-1.5"
      aria-label={`Priority: ${priority}`}
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full shrink-0",
          priorityColorMap[priority]
        )}
        aria-hidden="true"
      />
      {label && (
        <span
          className={cn(
            "text-[10px] font-medium tracking-wider uppercase",
            priority === "critical" ? "text-accent" : "text-ink"
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
