"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { useMeeting, useEndMeeting, useStartMeeting, useUpdateMeetingNotes } from "@/lib/hooks/use-meetings";
import { useSeriesDetail } from "@/lib/hooks/use-series";
import { useIssues, useCreateIssue, useUpdateIssueStatus, useUpdateIssue } from "@/lib/hooks/use-issues";
import { useDecisions, useCreateDecision } from "@/lib/hooks/use-decisions";
import { SyncIndicator } from "@/components/minutia/sync-indicator";
import { useOfflineSync } from "@/lib/hooks/use-offline-sync";
import { addPendingItem } from "@/lib/offline-buffer";
import { CaptureInput } from "@/components/minutia/capture-input";
import { InlineTaskList } from "@/components/minutia/inline-task-list";
import { IssueCard } from "@/components/minutia/issue-card";
import { BriefCard } from "@/components/minutia/brief-card";
import { StatusChip } from "@/components/minutia/status-chip";
import { CategoryBadge } from "@/components/minutia/category-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ShareButton } from "@/components/minutia/share-button";
import { ArrowLeft, Square, Play, Check, X, Copy, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IssueCategory, IssueStatus, Issue, Decision, Meeting } from "@/lib/types";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Post-meeting summary card
// ---------------------------------------------------------------------------

function AnimatedNumber({ value, delay = 0 }: { value: number; delay?: number }) {
  const [display, setDisplay] = React.useState(0);

  React.useEffect(() => {
    if (value === 0) return;
    const timeout = setTimeout(() => {
      const duration = 600;
      const start = performance.now();
      function tick(now: number) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplay(Math.round(eased * value));
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);

  return <>{display}</>;
}

function getInsightLine(raisedCount: number, decisionsCount: number, resolvedCount: number, stillOpenCount: number): string | null {
  const total = raisedCount + decisionsCount;
  if (total === 0) return null;

  if (resolvedCount > 0 && stillOpenCount === 0) {
    return "Clean slate. Every item accounted for.";
  }
  if (resolvedCount > raisedCount && resolvedCount > 0) {
    return `You closed more than you opened. Net progress: ${resolvedCount - raisedCount} items cleared.`;
  }
  if (stillOpenCount > 0 && raisedCount > 0) {
    return `${raisedCount} new items tracked. ${stillOpenCount} carried forward with accountability.`;
  }
  if (raisedCount > 0 && decisionsCount > 0) {
    return `${raisedCount} items captured, ${decisionsCount} decisions logged. Nothing lost.`;
  }
  if (raisedCount > 0) {
    return `${raisedCount} items captured. Each one tracked until resolved.`;
  }
  return null;
}

function MeetingSummaryCard({
  meeting,
  seriesName,
  raisedCount,
  decisionsCount,
  resolvedCount,
  stillOpenCount,
  raisedIssues,
  decisions,
  doneIssues,
}: {
  meeting: Meeting;
  seriesName: string;
  raisedCount: number;
  decisionsCount: number;
  resolvedCount: number;
  stillOpenCount: number;
  raisedIssues: Issue[];
  decisions: Decision[];
  doneIssues: Issue[];
}) {
  const [copied, setCopied] = React.useState(false);

  const summaryText = React.useMemo(() => {
    const lines: string[] = [];
    lines.push(`${meeting.title} - ${seriesName}`);
    lines.push(formatMeetingDate(meeting.date));
    if (meeting.attendees?.length) {
      lines.push(`Attendees: ${meeting.attendees.join(", ")}`);
    }
    lines.push("");
    lines.push(`Items raised: ${raisedCount}`);
    if (raisedIssues.length > 0) {
      for (const issue of raisedIssues) {
        lines.push(`  - ${issue.title} [${issue.category}]`);
      }
    }
    lines.push("");
    lines.push(`Decisions made: ${decisionsCount}`);
    if (decisions.length > 0) {
      for (const d of decisions) {
        lines.push(`  - ${d.title}`);
      }
    }
    if (resolvedCount > 0) {
      lines.push("");
      lines.push(`Resolved/dropped this meeting: ${resolvedCount}`);
      for (const issue of doneIssues) {
        lines.push(`  - ${issue.title} [${issue.status}]`);
      }
    }
    if (stillOpenCount > 0) {
      lines.push("");
      lines.push(`Still open (carried): ${stillOpenCount}`);
    }
    return lines.join("\n");
  }, [meeting, seriesName, raisedCount, decisionsCount, resolvedCount, stillOpenCount, raisedIssues, decisions, doneIssues]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(summaryText);
    } catch {
      // Clipboard API unavailable (e.g. headless browser)
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const insightLine = getInsightLine(raisedCount, decisionsCount, resolvedCount, stillOpenCount);
  const totalTracked = raisedCount + decisionsCount + resolvedCount;

  const stats = [
    { label: "Raised", value: raisedCount, color: "text-ink" },
    { label: "Decisions", value: decisionsCount, color: "text-ink" },
    { label: "Resolved", value: resolvedCount, color: "text-success" },
    { label: "Carried", value: stillOpenCount, color: stillOpenCount > 0 ? "text-warn" : "text-ink" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className="mb-8 rounded-xl border-2 border-accent/20 bg-paper-2 p-6 relative overflow-hidden"
    >
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-accent" />

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Meeting complete
          </h2>
          <p className="text-xs font-mono text-ink-4 mt-0.5">
            {formatMeetingDate(meeting.date)}
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink transition-colors overflow-hidden rounded-md px-2.5 py-1.5 border border-rule hover:border-rule-strong"
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="copied"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.16 }}
                className="inline-flex items-center gap-1.5"
              >
                <CheckCheck className="size-3.5 text-success" />
                Copied
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.16 }}
                className="inline-flex items-center gap-1.5"
              >
                <Copy className="size-3.5" />
                Copy summary
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-5">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 + i * 0.08 }}
            className="text-center"
          >
            <p className={cn("font-display text-3xl font-bold tabular-nums", stat.color)}>
              <AnimatedNumber value={stat.value} delay={200 + i * 80} />
            </p>
            <p className="text-[11px] text-ink-3 mt-1 tracking-wide uppercase">
              {stat.label}
            </p>
          </motion.div>
        ))}
      </div>

      {insightLine && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="text-sm text-ink-2 text-center py-3 border-t border-rule"
        >
          {insightLine}
        </motion.p>
      )}

      {totalTracked > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 1.1 }}
          className="text-center pt-2"
        >
          <p className="text-[11px] text-ink-4">
            In a spreadsheet, {totalTracked === 1 ? "this item" : `these ${totalTracked} items`} would be copy-pasted into cells and forgotten by next meeting.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}

interface MeetingDetailContentProps {
  seriesId: string;
  meetingId: string;
}

function formatMeetingDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatCompactDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Live timer hook
// ---------------------------------------------------------------------------

function useLiveTimer(startTime: Date | string | null) {
  const [elapsed, setElapsed] = React.useState("00:00:00");

  React.useEffect(() => {
    if (!startTime) return;
    const start = new Date(startTime).getTime();

    function tick() {
      const diff = Math.max(0, Date.now() - start);
      const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
      const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
      const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
      setElapsed(`${h}:${m}:${s}`);
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return elapsed;
}

// ---------------------------------------------------------------------------
// Attendee avatar
// ---------------------------------------------------------------------------

function AttendeeAvatar({ name, className }: { name: string; className?: string }) {
  const initial = name.charAt(0).toUpperCase();
  const colors = [
    "bg-accent text-white",
    "bg-ink text-paper",
    "bg-success text-white",
    "bg-warn text-white",
  ];
  const colorIdx = name.charCodeAt(0) % colors.length;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center size-7 rounded-full text-[11px] font-medium font-mono ring-2 ring-paper",
        colors[colorIdx],
        className
      )}
      title={name}
    >
      {initial}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Keyboard-hint carried issue card
// ---------------------------------------------------------------------------

function CarriedIssueCard({
  issue,
  onStatusChange,
  index,
  done,
}: {
  issue: Issue;
  onStatusChange: (issueId: string, newStatus: IssueStatus) => void;
  index: number;
  done?: boolean;
}) {
  const [selected, setSelected] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [justChanged, setJustChanged] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  const showActions = !done && (selected || hovered);

  function handleKey(e: React.KeyboardEvent) {
    if (done) return;
    if (e.key === "Escape") {
      setSelected(false);
      return;
    }
    const keyMap: Record<string, IssueStatus> = {
      r: "resolved",
      p: "in_progress",
      x: "dropped",
      o: "open",
    };
    const newStatus = keyMap[e.key.toLowerCase()];
    if (newStatus && newStatus !== issue.status) {
      e.preventDefault();
      setJustChanged(newStatus);
      onStatusChange(issue.id, newStatus);
      setTimeout(() => setJustChanged(null), 600);
    }
  }

  function handleActionClick(newStatus: IssueStatus) {
    if (newStatus === issue.status) return;
    setJustChanged(newStatus);
    onStatusChange(issue.id, newStatus);
    setTimeout(() => setJustChanged(null), 600);
  }

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8, transition: { duration: 0.2 } }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      tabIndex={done ? undefined : 0}
      onClick={done ? undefined : () => setSelected((s) => !s)}
      onFocus={done ? undefined : () => setSelected(true)}
      onBlur={done ? undefined : (e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) {
          setSelected(false);
        }
      }}
      onMouseEnter={done ? undefined : () => setHovered(true)}
      onMouseLeave={done ? undefined : () => setHovered(false)}
      onKeyDown={handleKey}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg py-3 transition-all outline-none",
        done
          ? "px-4 opacity-50"
          : "px-4 cursor-pointer border border-transparent",
        !done && selected && "border-accent/40 bg-card ring-1 ring-accent/20",
        !done && !selected && hovered && "border-rule bg-card",
      )}
    >
      {/* Selected accent bar */}
      {selected && !done && (
        <motion.div
          layoutId="carried-select-bar"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent rounded-sm"
        />
      )}

      {/* Status indicator */}
      {done ? (
        <span className={cn(
          "inline-flex items-center justify-center size-4 rounded-full shrink-0",
          issue.status === "resolved" ? "bg-success/20" : "bg-ink-4/20"
        )}>
          {issue.status === "resolved"
            ? <Check className="size-2.5 text-success" />
            : <X className="size-2.5 text-ink-4" />
          }
        </span>
      ) : (
        <span
          className={cn(
            "size-2 rounded-full shrink-0 transition-colors",
            issue.status === "in_progress" ? "bg-accent" :
            issue.status === "resolved" ? "bg-success" :
            issue.status === "dropped" ? "bg-ink-4" :
            "bg-ink"
          )}
        />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/issues/${issue.id}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "text-sm font-medium transition-all hover:text-accent",
            done ? "line-through text-ink-3 hover:text-ink-3" : "text-ink"
          )}
        >
          {issue.title}
        </Link>
        <div className="flex items-center gap-2 mt-0.5">
          <CategoryBadge category={issue.category} size="sm" />
          {issue.owner_name && (
            <span className="text-xs font-mono text-ink-4">{issue.owner_name}</span>
          )}
          {issue.due_date && (
            <span className={cn(
              "text-xs font-mono tabular-nums",
              !done && new Date(issue.due_date) < new Date() ? "text-accent" : "text-ink-4"
            )}>
              {formatCompactDate(issue.due_date)}
            </span>
          )}
        </div>
      </div>

      {/* Done badge */}
      {done && (
        <span className={cn(
          "text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0",
          issue.status === "resolved" ? "bg-success/10 text-success" : "bg-paper-2 text-ink-4"
        )}>
          {issue.status === "resolved" ? "Resolved" : "Dropped"}
        </span>
      )}

      {/* Action buttons (visible on hover/focus/select) */}
      <AnimatePresence>
        {showActions && !justChanged && (
          <motion.div
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.12 }}
            className="flex items-center gap-1 shrink-0"
          >
            <ActionButton letter="R" label="Resolve" onClick={() => handleActionClick("resolved")} />
            <ActionButton letter="P" label="Progress" onClick={() => handleActionClick("in_progress")} />
            <ActionButton letter="X" label="Drop" onClick={() => handleActionClick("dropped")} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Flash confirmation */}
      <AnimatePresence>
        {justChanged && (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full",
              justChanged === "resolved" && "bg-success-soft text-success",
              justChanged === "in_progress" && "bg-accent-soft text-accent",
              justChanged === "dropped" && "bg-paper-2 text-ink-3"
            )}
          >
            {justChanged === "resolved" ? "Resolved" :
             justChanged === "in_progress" ? "In Progress" :
             justChanged === "dropped" ? "Dropped" : justChanged}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ActionButton({ letter, label, onClick }: { letter: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-paper-2 transition-colors"
      title={`${letter} to ${label}`}
    >
      <kbd className={cn(
        "inline-flex items-center justify-center size-5 rounded text-[10px] font-mono font-medium",
        "bg-paper-2 text-ink-3 border border-rule"
      )}>
        {letter}
      </kbd>
      <span className="text-[10px] text-ink-4 hidden lg:inline">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Today's capture item
// ---------------------------------------------------------------------------

function CapturedItem({
  issue,
  index,
  onStatusChange,
}: {
  issue: Issue;
  index: number;
  onStatusChange: (issueId: string, newStatus: IssueStatus) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.18 }}
      className="flex items-center gap-3 rounded-lg px-4 py-3 hover:bg-card transition-colors group"
    >
      <span className="text-xs font-mono text-ink-4 tabular-nums w-5 text-right shrink-0">
        {String(index + 1).padStart(2, "0")}
      </span>
      <CategoryBadge category={issue.category} size="sm" />
      <Link
        href={`/issues/${issue.id}`}
        className="flex-1 min-w-0 text-sm font-medium text-ink group-hover:text-accent transition-colors truncate"
      >
        {issue.title}
      </Link>
      {issue.owner_name && (
        <span className="text-xs font-mono text-ink-4">{issue.owner_name}</span>
      )}
      {issue.due_date && (
        <span className={cn(
          "text-xs font-mono tabular-nums",
          new Date(issue.due_date) < new Date() ? "text-accent" : "text-ink-4"
        )}>
          {formatCompactDate(issue.due_date)}
        </span>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MeetingDetailContent({
  seriesId,
  meetingId,
}: MeetingDetailContentProps) {
  const router = useRouter();
  const { data: meeting, isLoading: meetingLoading } = useMeeting(meetingId);
  const { data: series } = useSeriesDetail(seriesId);
  const { data: seriesIssues } = useIssues(seriesId);
  const { data: decisions } = useDecisions(meetingId);

  const endMeeting = useEndMeeting();
  const startMeeting = useStartMeeting();
  const createIssue = useCreateIssue();
  const createDecision = useCreateDecision();
  const updateIssueStatus = useUpdateIssueStatus();
  const updateIssue = useUpdateIssue();

  const { isOnline, pendingCount, syncStatus, refreshCount } = useOfflineSync();

  const [notes, setNotes] = React.useState(meeting?.notes_markdown ?? "");
  const updateNotes = useUpdateMeetingNotes();
  const timer = useLiveTimer(meeting?.status === "live" ? meeting.created_at : null);

  React.useEffect(() => {
    if (meeting?.notes_markdown) setNotes(meeting.notes_markdown);
  }, [meeting?.notes_markdown]);

  // Auto-save notes with debounce
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout>>(null);
  const handleNotesChange = React.useCallback(
    (value: string) => {
      setNotes(value);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateNotes.mutate({ meetingId, notes: value });
      }, 1000);
    },
    [meetingId, updateNotes]
  );

  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  if (meetingLoading) {
    return (
      <div className="min-h-full bg-paper">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton className="h-px w-full mb-6" />
          <Skeleton className="h-6 w-48 mb-2" />
          <Skeleton className="h-8 w-64 mb-8" />
          <Skeleton className="h-16 w-full mb-4" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="min-h-full bg-paper flex items-center justify-center">
        <p className="text-sm text-ink-3">Meeting not found.</p>
      </div>
    );
  }

  const meetingIssues = meeting.issues ?? [];
  const meetingDecisions = meeting.decisions ?? decisions ?? [];
  const raisedInThisMeeting = meetingIssues;

  const allCarriedIssues = (seriesIssues ?? []).filter(
    (issue) => issue.raised_in_meeting_id !== meetingId
  );
  const carriedIssues = allCarriedIssues.filter(
    (issue) => issue.status !== "resolved" && issue.status !== "dropped"
  );
  // Issues resolved/dropped during this meeting (both carried AND raised here)
  const allSeriesIssues = seriesIssues ?? [];
  const doneThisMeeting = allSeriesIssues.filter(
    (issue) =>
      (issue.status === "resolved" || issue.status === "dropped") &&
      issue.resolved_in_meeting_id === meetingId
  );

  const meetingSequence = series?.meetings
    ? [...series.meetings]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .findIndex((m) => m.id === meetingId) + 1
    : null;

  // Handlers
  async function handleCapture(text: string, category: IssueCategory) {
    if (isOnline) {
      try {
        if (category === "decision") {
          await createDecision.mutateAsync({
            title: text,
            meeting_id: meetingId,
            series_id: seriesId,
          });
        } else {
          await createIssue.mutateAsync({
            title: text,
            category,
            priority: "medium",
            meeting_id: meetingId,
            series_id: seriesId,
          });
        }
      } catch {
        // Online but request failed; buffer locally
        await addPendingItem({
          id: crypto.randomUUID(),
          type: category === "decision" ? "decision" : "issue",
          title: text,
          category: category === "decision" ? undefined : category,
          priority: category === "decision" ? undefined : "medium",
          meeting_id: meetingId,
          series_id: seriesId,
          created_at: new Date().toISOString(),
        });
        await refreshCount();
      }
    } else {
      // Offline; buffer immediately
      await addPendingItem({
        id: crypto.randomUUID(),
        type: category === "decision" ? "decision" : "issue",
        title: text,
        category: category === "decision" ? undefined : category,
        priority: category === "decision" ? undefined : "medium",
        meeting_id: meetingId,
        series_id: seriesId,
        created_at: new Date().toISOString(),
      });
      await refreshCount();
    }
  }

  function handleStatusChange(issueId: string, newStatus: IssueStatus) {
    const issue = [...raisedInThisMeeting, ...allSeriesIssues].find(
      (i) => i.id === issueId
    );
    if (!issue) return;
    updateIssueStatus.mutate({
      issueId,
      seriesId,
      oldStatus: issue.status,
      newStatus,
      meetingId,
    });
  }

  async function handleEndMeeting() {
    await endMeeting.mutateAsync(meetingId);
  }

  async function handleStartMeeting() {
    await startMeeting.mutateAsync(meetingId);
  }

  function handleTitleChange(issueId: string, title: string) {
    updateIssue.mutate({ issueId, title });
  }

  function handleAssigneeChange(issueId: string, ownerName: string | null) {
    updateIssue.mutate({ issueId, owner_name: ownerName });
  }

  async function handleInlineAdd(title: string, category: IssueCategory) {
    await handleCapture(title, category);
  }

  // =========================================================================
  // LIVE MODE
  // =========================================================================
  if (meeting.status === "live") {
    return (
      <div className="min-h-full bg-paper">
        <SyncIndicator status={syncStatus} pendingCount={pendingCount} />

        {/* Header bar */}
        <div className="border-b border-rule">
          <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 bg-accent text-white text-[10px] font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider">
                <span className="size-1.5 rounded-full bg-white animate-pulse" />
                Live
              </span>
              <div>
                <h1 className="font-display text-base font-semibold text-ink leading-tight">
                  {series?.name}
                  {meetingSequence && (
                    <span className="text-ink-3 font-normal"> — M-{meetingSequence}</span>
                  )}
                </h1>
                <p className="text-xs font-mono text-ink-4">
                  {formatCompactDate(meeting.date)} · {meeting.attendees?.length ?? 0} attendees present
                </p>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-4">
              <span className="text-sm font-mono text-ink-2 tabular-nums tracking-wider">
                {timer}
              </span>

              {/* Attendee avatars */}
              {meeting.attendees && meeting.attendees.length > 0 && (
                <div className="flex -space-x-1.5">
                  {meeting.attendees.slice(0, 5).map((name) => (
                    <AttendeeAvatar key={name} name={name} />
                  ))}
                  {meeting.attendees.length > 5 && (
                    <span className="inline-flex items-center justify-center size-7 rounded-full bg-paper-2 text-[10px] font-medium text-ink-3 ring-2 ring-paper">
                      +{meeting.attendees.length - 5}
                    </span>
                  )}
                </div>
              )}

              <Button
                onClick={handleEndMeeting}
                disabled={endMeeting.isPending}
                variant="outline"
                className="text-ink border-rule hover:bg-paper-2"
              >
                <Square className="size-3" />
                End meeting
              </Button>
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="mx-auto max-w-7xl px-6 py-6 flex gap-6">
          {/* Main column */}
          <div className="flex-1 min-w-0">
            {/* Capture input */}
            <div className="mb-8 rounded-xl border border-rule bg-card p-5">
              <CaptureInput onSubmit={handleCapture} />
            </div>

            {/* Carried from last meeting */}
            {(carriedIssues.length > 0 || doneThisMeeting.length > 0) && (
              <section className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 font-medium">
                    Carried from last meeting
                  </h2>
                  <span className="text-[11px] font-mono text-ink-4 tabular-nums">
                    {carriedIssues.length}
                  </span>
                  <div className="flex-1 border-t border-dashed border-rule" />
                </div>
                <div>
                  <AnimatePresence mode="popLayout">
                    {carriedIssues.map((issue, idx) => (
                      <CarriedIssueCard
                        key={issue.id}
                        issue={issue}
                        index={idx}
                        onStatusChange={handleStatusChange}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                {doneThisMeeting.length > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-ink-4/60">
                        Done this meeting
                      </span>
                      <span className="text-[10px] font-mono text-ink-4/60 tabular-nums">
                        {doneThisMeeting.length}
                      </span>
                      <div className="flex-1 border-t border-dashed border-rule/50" />
                    </div>
                    <div>
                      {doneThisMeeting.map((issue, idx) => (
                        <CarriedIssueCard
                          key={issue.id}
                          issue={issue}
                          index={idx}
                          onStatusChange={handleStatusChange}
                          done
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Today's capture */}
            <section>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 font-medium">
                  Today&apos;s capture
                </h2>
                <span className="text-[11px] font-mono text-ink-4 tabular-nums">
                  {raisedInThisMeeting.length}
                </span>
                <div className="flex-1 border-t border-dashed border-rule" />
              </div>
              <div aria-live="polite" aria-relevant="additions">
                <InlineTaskList
                  issues={raisedInThisMeeting}
                  attendees={meeting.attendees ?? series?.default_attendees ?? []}
                  onStatusChange={handleStatusChange}
                  onTitleChange={handleTitleChange}
                  onAssigneeChange={handleAssigneeChange}
                  onAddItem={handleInlineAdd}
                />
              </div>
            </section>

            {/* Decisions */}
            {(decisions ?? []).length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 font-medium">
                    Decisions
                  </h2>
                  <span className="text-[11px] font-mono text-ink-4 tabular-nums">
                    {(decisions ?? []).length}
                  </span>
                  <div className="flex-1 border-t border-dashed border-rule" />
                </div>
                <div className="space-y-1">
                  {(decisions ?? []).map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-paper-2 transition-colors"
                    >
                      <span className="text-accent text-xs">&#9670;</span>
                      <span className="flex-1 text-sm text-ink">{d.title}</span>
                      <span className="text-[10px] text-ink-4 font-medium uppercase tracking-wider">Decision</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Notes sidebar */}
          <div className="w-80 shrink-0 hidden lg:block">
            <div className="sticky top-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 font-medium">
                  Freeform notes
                </h3>
                <span className="text-[10px] text-ink-4">Autosaved</span>
              </div>
              <Textarea
                value={notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Type meeting notes here..."
                className="min-h-[300px] bg-card border-rule text-sm font-sans leading-relaxed resize-y"
              />
              <div className="mt-4 pt-4 border-t border-rule">
                <h3 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 font-medium mb-3">
                  Sync status
                </h3>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "size-2 rounded-full",
                    syncStatus === "synced" ? "bg-success" :
                    syncStatus === "syncing" ? "bg-warn animate-pulse" :
                    "bg-warn"
                  )} />
                  <span className="text-xs text-ink-3">
                    {syncStatus === "synced" && "Synced"}
                    {syncStatus === "syncing" && "Syncing..."}
                    {syncStatus === "offline" && (
                      pendingCount > 0
                        ? `${pendingCount} item${pendingCount === 1 ? "" : "s"} buffered`
                        : "Offline"
                    )}
                  </span>
                </div>
                <p className="text-[10px] text-ink-4 mt-1.5">
                  Offline capture buffered locally; auto-syncs when connection returns.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // UPCOMING MODE
  // =========================================================================
  if (meeting.status === "upcoming") {
    const openIssues = (seriesIssues ?? []).filter(
      (issue) => issue.status !== "resolved" && issue.status !== "dropped"
    );

    return (
      <div className="min-h-full bg-paper">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-6">
            <Link
              href={`/series/${seriesId}`}
              className="text-ink-3 hover:text-ink transition-colors"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-2">{series?.name}</span>
                {meetingSequence && (
                  <span className="text-xs font-mono text-ink-4">
                    M-{meetingSequence}
                  </span>
                )}
              </div>
              <h1 className="font-display text-xl font-semibold text-ink mt-1">
                {meeting.title}
              </h1>
            </div>
            <Button
              onClick={handleStartMeeting}
              disabled={startMeeting.isPending}
              className="bg-accent text-white hover:bg-accent-hover"
            >
              <Play className="size-4" />
              Start meeting
            </Button>
          </div>

          <div className="mb-8">
            <BriefCard
              seriesName={series?.name ?? ""}
              nextMeetingDate={new Date(meeting.date)}
              pendingIssues={openIssues.slice(0, 10)}
            />
          </div>

          {meeting.attendees && meeting.attendees.length > 0 && (
            <section>
              <h2 className="font-display text-lg font-medium text-ink mb-3">
                Attendees
              </h2>
              <div className="flex flex-wrap gap-2">
                {meeting.attendees.map((attendee) => (
                  <span
                    key={attendee}
                    className="text-xs bg-paper-2 text-ink-2 px-2.5 py-1 rounded-full"
                  >
                    {attendee}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // COMPLETED MODE
  // =========================================================================
  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href={`/series/${seriesId}`}
            className="text-ink-3 hover:text-ink transition-colors"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-2">{series?.name}</span>
              {meetingSequence && (
                <span className="text-xs font-mono text-ink-4">
                  M-{meetingSequence}
                </span>
              )}
            </div>
            <h1 className="font-display text-xl font-semibold text-ink mt-1">
              {meeting.title}
            </h1>
            <p className="text-xs font-mono text-ink-4 mt-1">
              {formatMeetingDate(meeting.date)}
            </p>
          </div>
          <ShareButton resource_type="meeting" resource_id={meetingId} />
        </div>

        {meeting.attendees && meeting.attendees.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {meeting.attendees.map((attendee) => (
              <span
                key={attendee}
                className="text-xs bg-paper-2 text-ink-2 px-2.5 py-1 rounded-full"
              >
                {attendee}
              </span>
            ))}
          </div>
        )}

        <MeetingSummaryCard
          meeting={meeting}
          seriesName={series?.name ?? ""}
          raisedCount={raisedInThisMeeting.length}
          decisionsCount={meetingDecisions.length}
          resolvedCount={doneThisMeeting.length}
          stillOpenCount={carriedIssues.length}
          raisedIssues={raisedInThisMeeting}
          decisions={meetingDecisions}
          doneIssues={doneThisMeeting}
        />

        <section className="mb-8">
          <h2 className="font-display text-lg font-medium text-ink mb-4">
            Items raised ({raisedInThisMeeting.length})
          </h2>
          <InlineTaskList
            issues={raisedInThisMeeting}
            attendees={meeting.attendees ?? series?.default_attendees ?? []}
            onStatusChange={handleStatusChange}
            onTitleChange={handleTitleChange}
            onAssigneeChange={handleAssigneeChange}
            onAddItem={handleInlineAdd}
          />
        </section>

        {doneThisMeeting.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-lg font-medium text-ink mb-4">
              Resolved this meeting ({doneThisMeeting.length})
            </h2>
            <InlineTaskList
              issues={doneThisMeeting}
              attendees={meeting.attendees ?? series?.default_attendees ?? []}
              onStatusChange={handleStatusChange}
              onTitleChange={handleTitleChange}
              onAssigneeChange={handleAssigneeChange}
            />
          </section>
        )}

        {meetingDecisions.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-lg font-medium text-ink mb-4">
              Decisions ({meetingDecisions.length})
            </h2>
            <div className="space-y-3">
              {meetingDecisions.map((decision) => (
                <div
                  key={decision.id}
                  className="bg-card border border-rule rounded-md p-4"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-ink-3 shrink-0" aria-hidden="true">
                      ◆
                    </span>
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {decision.title}
                      </p>
                      {decision.rationale && (
                        <p className="text-xs text-ink-2 mt-1">
                          {decision.rationale}
                        </p>
                      )}
                      {decision.made_by && (
                        <p className="text-xs text-ink-3 mt-1">
                          by {decision.made_by}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="font-display text-lg font-medium text-ink mb-4">
            Notes
          </h2>
          <Textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Meeting notes..."
            className="min-h-[120px] font-sans text-sm"
          />
        </section>
      </div>
    </div>
  );
}
