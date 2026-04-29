"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { Meeting } from "@/lib/types";
import Link from "next/link";

interface MeetingTimelineItemProps {
  meeting: Meeting;
  seriesId: string;
  sequence: number;
  itemsRaised?: number;
  itemsResolved?: number;
  isLast?: boolean;
  index?: number;
}

function formatMeetingDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const statusBadgeMap: Record<string, { label: string; className: string }> = {
  live: {
    label: "LIVE",
    className: "bg-accent text-white",
  },
  upcoming: {
    label: "Upcoming",
    className: "bg-paper-3 text-ink-3",
  },
  completed: {
    label: "",
    className: "",
  },
};

export function MeetingTimelineItem({
  meeting,
  seriesId,
  sequence,
  itemsRaised = 0,
  itemsResolved = 0,
  isLast = false,
  index = 0,
}: MeetingTimelineItemProps) {
  const badge = statusBadgeMap[meeting.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.18,
        delay: index * 0.06,
        ease: [0.2, 0.8, 0.2, 1],
      }}
      className="relative flex gap-4"
    >
      {/* Timeline track */}
      <div className="relative flex flex-col items-center pt-1">
        {/* Node */}
        <div
          className={cn(
            "size-2.5 rounded-full shrink-0",
            meeting.status === "live" ? "bg-accent" : "bg-ink-3"
          )}
          aria-hidden="true"
        />

        {/* Line below */}
        {!isLast && (
          <div className="w-px flex-1 bg-rule mt-1" aria-hidden="true" />
        )}
      </div>

      {/* Content */}
      <Link
        href={`/series/${seriesId}/meetings/${meeting.id}`}
        className="flex-1 pb-6 group"
      >
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-mono text-ink font-medium group-hover:text-accent transition-colors">
            M-{sequence}
          </span>
          <span className="text-xs font-mono text-ink-4">
            {formatMeetingDate(meeting.date)}
          </span>
          {badge && badge.label && (
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                badge.className
              )}
            >
              {badge.label}
            </span>
          )}
        </div>

        {meeting.status === "completed" && (
          <div className="flex items-center gap-3 text-xs text-ink-3">
            <span>{itemsRaised} raised</span>
            <span className="text-ink-4">/</span>
            <span>{itemsResolved} resolved</span>
          </div>
        )}

        {meeting.title && (
          <p className="text-xs text-ink-2 mt-0.5 truncate">{meeting.title}</p>
        )}
      </Link>
    </motion.div>
  );
}
