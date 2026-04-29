"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { STATUS_CONFIG } from "@/lib/constants";
import { Check } from "lucide-react";
import type { Meeting, IssueUpdate } from "@/lib/types";

interface TimelineNodeProps {
  meeting: Meeting;
  update?: IssueUpdate;
  isFirst?: boolean;
  isLast?: boolean;
  isResolved?: boolean;
  index?: number;
}

function formatMeetingDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TimelineNode({
  meeting,
  update,
  isFirst,
  isLast,
  isResolved,
  index = 0,
}: TimelineNodeProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.18,
        delay: index * 0.09,
        ease: [0.2, 0.8, 0.2, 1],
      }}
      className="relative flex gap-4"
    >
      {/* Timeline track */}
      <div className="relative flex flex-col items-center">
        {/* Line above */}
        {!isFirst && (
          <div className="w-px flex-1 bg-ink-3" aria-hidden="true" />
        )}
        {isFirst && <div className="flex-1" />}

        {/* Node */}
        {isResolved ? (
          <div
            className="flex items-center justify-center size-3.5 rounded-full bg-success shrink-0"
            aria-label="Resolved"
          >
            <Check className="size-2.5 text-white" strokeWidth={3} />
          </div>
        ) : (
          <div
            className="size-2 rounded-full bg-ink shrink-0"
            aria-hidden="true"
          />
        )}

        {/* Line below */}
        {!isLast && (
          <div className="w-px flex-1 bg-ink-3" aria-hidden="true" />
        )}
        {isLast && <div className="flex-1" />}
      </div>

      {/* Content */}
      <div className="pb-6 pt-0 min-w-0">
        {/* Meeting label */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono text-ink-3">
            {meeting.title}
          </span>
          <span className="text-xs font-mono text-ink-4">
            {formatMeetingDate(meeting.date)}
          </span>
        </div>

        {/* Update content */}
        {update && (
          <div className="mt-1">
            {update.previous_status && update.new_status && update.previous_status !== update.new_status && (
              <span className="text-xs text-ink-2">
                {STATUS_CONFIG[update.previous_status].label}
                {" "}
                &rarr;
                {" "}
                {STATUS_CONFIG[update.new_status].label}
              </span>
            )}
            {update.note && (
              <p className="text-sm text-ink-2 mt-1 leading-relaxed">
                {update.note}
              </p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
