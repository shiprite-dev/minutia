"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import {
  ChevronRight,
  Circle,
  CheckCircle2,
  Radio,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/minutia/category-badge";
import { useUIStore } from "@/lib/stores/ui-store";
import type { Meeting, Issue, Decision } from "@/lib/types";

interface TimelineMeeting extends Meeting {
  issues: Issue[];
  decisions: Decision[];
}

interface DateAnchoredTimelineProps {
  meetings: TimelineMeeting[];
  seriesId: string;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateHeader(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

const statusIcon: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="size-4 text-success" />,
  live: <Radio className="size-4 text-accent animate-pulse" />,
  upcoming: <Clock className="size-4 text-ink-3" />,
};

const ISSUE_PREVIEW_LIMIT = 5;

function MeetingSection({
  meeting,
  seriesId,
  index,
  isFuture,
  scrollTargetRef,
}: {
  meeting: TimelineMeeting;
  seriesId: string;
  index: number;
  isFuture: boolean;
  scrollTargetRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [expanded, setExpanded] = React.useState(index === 0 && !isFuture);
  const [showAllIssues, setShowAllIssues] = React.useState(false);
  const meetingDate = new Date(meeting.date);
  const issueCount = meeting.issues.length;
  const resolvedCount = meeting.issues.filter(
    (i) => i.status === "resolved"
  ).length;
  const openCount = issueCount - resolvedCount;

  const topIssue = meeting.issues[0];

  return (
    <motion.div
      ref={scrollTargetRef}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.2,
        delay: Math.min(index * 0.04, 0.4),
        ease: [0.2, 0.8, 0.2, 1],
      }}
      className={cn("relative", isFuture && "opacity-50")}
    >
      {/* Clickable header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left group flex items-start gap-3 py-3 px-3 -mx-3 rounded-lg hover:bg-paper-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        {/* Timeline node */}
        <div className="flex flex-col items-center pt-0.5 shrink-0">
          {statusIcon[meeting.status] ?? <Circle className="size-4 text-ink-4" />}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink group-hover:text-accent transition-colors truncate">
              {meeting.title}
            </span>
            <ChevronRight
              className={cn(
                "size-3.5 text-ink-4 transition-transform shrink-0",
                expanded && "rotate-90"
              )}
            />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-mono text-ink-3">
              {formatDateHeader(meetingDate)}
            </span>
            {meeting.status !== "upcoming" && (
              <>
                <span className="text-ink-4 text-xs">·</span>
                <span className="text-xs text-ink-3">
                  {formatTime(meetingDate)}
                </span>
              </>
            )}
          </div>

          {/* Collapsed preview */}
          {!expanded && issueCount > 0 && (
            <div className="flex items-center gap-3 mt-1.5 text-xs text-ink-3">
              <span>{issueCount} items</span>
              {resolvedCount > 0 && (
                <>
                  <span className="text-ink-4">·</span>
                  <span className="text-success">{resolvedCount} resolved</span>
                </>
              )}
              {topIssue && (
                <>
                  <span className="text-ink-4">·</span>
                  <span className="truncate max-w-[200px]">{topIssue.title}</span>
                </>
              )}
            </div>
          )}
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pl-10 pb-2 space-y-4">
              {/* Issues */}
              {meeting.issues.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-2">
                    Issues ({meeting.issues.length})
                  </p>
                  <div className="space-y-1">
                    {(showAllIssues ? meeting.issues : meeting.issues.slice(0, ISSUE_PREVIEW_LIMIT)).map((issue) => (
                      <Link
                        key={issue.id}
                        href={`/issues/${issue.id}`}
                        className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md hover:bg-paper-3 transition-colors group/issue"
                      >
                        <span
                          className={cn(
                            "size-4 shrink-0 rounded-sm flex items-center justify-center border",
                            issue.status === "resolved"
                              ? "bg-success/10 border-success/30 text-success"
                              : issue.status === "dropped"
                                ? "bg-ink-4/10 border-ink-4/30 text-ink-4 line-through"
                                : "border-rule text-transparent"
                          )}
                        >
                          {(issue.status === "resolved" || issue.status === "dropped") && (
                            <CheckCircle2 className="size-3" />
                          )}
                        </span>
                        <span
                          className={cn(
                            "text-sm truncate flex-1",
                            issue.status === "resolved"
                              ? "text-ink-3 line-through"
                              : issue.status === "dropped"
                                ? "text-ink-4 line-through"
                                : "text-ink group-hover/issue:text-accent"
                          )}
                        >
                          {issue.title}
                        </span>
                        <CategoryBadge category={issue.category} size="sm" />
                      </Link>
                    ))}
                  </div>
                  {!showAllIssues && meeting.issues.length > ISSUE_PREVIEW_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllIssues(true)}
                      className="mt-1.5 text-xs text-accent hover:underline"
                    >
                      Show all {meeting.issues.length} items
                    </button>
                  )}
                </div>
              )}

              {/* Decisions */}
              {meeting.decisions.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-2">
                    Decisions ({meeting.decisions.length})
                  </p>
                  <div className="space-y-1">
                    {meeting.decisions.map((decision) => (
                      <div
                        key={decision.id}
                        className="flex items-start gap-2 py-1.5 px-2 -mx-2"
                      >
                        <span className="text-accent mt-0.5 text-xs">◆</span>
                        <span className="text-sm text-ink">{decision.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {meeting.issues.length === 0 && meeting.decisions.length === 0 && (
                <p className="text-xs text-ink-4 italic">No items recorded</p>
              )}

              {/* Link to full meeting */}
              <Link
                href={`/series/${seriesId}/meetings/${meeting.id}`}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                Open meeting details
                <ChevronRight className="size-3" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const INITIAL_DISPLAY_COUNT = 5;

export function DateAnchoredTimeline({
  meetings,
  seriesId,
}: DateAnchoredTimelineProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selectedDate = useUIStore((s) => s.selectedDate);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const todayRef = React.useRef<HTMLDivElement | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  // Sort descending (newest first)
  const sorted = React.useMemo(
    () =>
      [...meetings].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    [meetings]
  );

  // Find the index where "today" divider should appear (first meeting older than today)
  const todayIndex = sorted.findIndex(
    (m) => new Date(m.date).getTime() < today.getTime()
  );

  // Scroll to today on mount
  React.useEffect(() => {
    if (todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  // Scroll to selected date from calendar sidebar
  React.useEffect(() => {
    if (!scrollRef.current) return;
    const targetDate = new Date(selectedDate);
    targetDate.setHours(0, 0, 0, 0);

    const meetingEls = scrollRef.current.querySelectorAll("[data-meeting-date]");
    let closest: Element | null = null;
    let closestDiff = Infinity;

    meetingEls.forEach((el) => {
      const dateStr = el.getAttribute("data-meeting-date");
      if (!dateStr) return;
      const diff = Math.abs(new Date(dateStr).getTime() - targetDate.getTime());
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = el;
      }
    });

    if (closest) {
      (closest as HTMLElement).scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [selectedDate]);

  if (sorted.length === 0) return null;

  const displayed = showAll ? sorted : sorted.slice(0, INITIAL_DISPLAY_COUNT);
  const hasMore = sorted.length > INITIAL_DISPLAY_COUNT;

  return (
    <div ref={scrollRef} className="relative">
      {/* Vertical timeline line */}
      <div
        className="absolute left-[17px] top-4 bottom-4 w-px bg-rule"
        aria-hidden="true"
      />

      <div className="space-y-0">
        {displayed.map((meeting, i) => {
          const meetingDate = new Date(meeting.date);
          meetingDate.setHours(0, 0, 0, 0);
          const isFuture = meetingDate.getTime() > today.getTime();
          const isToday = isSameDay(meetingDate, today);
          // In descending order: show Today divider before the first past meeting
          const showTodayBefore =
            todayIndex === i &&
            !isToday &&
            (i === 0 || new Date(sorted[i - 1].date).getTime() >= today.getTime());

          return (
            <React.Fragment key={meeting.id}>
              {/* Today divider */}
              {(showTodayBefore || (isToday && i === todayIndex)) && (
                <div
                  ref={todayRef}
                  className="flex items-center gap-3 py-3"
                >
                  <div className="size-2 rounded-full bg-accent shrink-0 ml-[11px]" />
                  <div className="h-px flex-1 bg-accent/30" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-accent font-bold shrink-0 pr-1">
                    Today
                  </span>
                </div>
              )}

              <div data-meeting-date={meeting.date}>
                <MeetingSection
                  meeting={meeting}
                  seriesId={seriesId}
                  index={i}
                  isFuture={isFuture}
                />
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {hasMore && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 ml-10 text-xs text-accent hover:underline"
        >
          View all {sorted.length} meetings
        </button>
      )}
    </div>
  );
}
