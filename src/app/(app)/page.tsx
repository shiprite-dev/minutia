"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  Clock,
  Plus,
  X,
} from "lucide-react";
import {
  useIssues,
  useUpdateIssueStatus,
  useCreateIssue,
} from "@/lib/hooks/use-issues";
import { useSeries } from "@/lib/hooks/use-series";
import { useAllMeetings, useMeetings } from "@/lib/hooks/use-meetings";
import { PRIORITY_CONFIG } from "@/lib/constants";
import { StatusChip } from "@/components/minutia/status-chip";
import { CategoryBadge } from "@/components/minutia/category-badge";
import { PriorityIndicator } from "@/components/minutia/priority-indicator";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  Issue,
  IssueStatus,
  MeetingSeries,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isOverdue(issue: Issue): boolean {
  if (issue.status === "resolved" || issue.status === "dropped") return false;
  if (!issue.due_date) return false;
  return new Date(issue.due_date) < new Date();
}

function isOpen(issue: Issue): boolean {
  return issue.status !== "resolved" && issue.status !== "dropped";
}

function formatShortDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatWeekday(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();
}

function daysBetween(a: Date | string, b: Date | string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round(
    Math.abs(new Date(b).getTime() - new Date(a).getTime()) / msPerDay
  );
}

function ageGroup(days: number): string {
  if (days <= 7) return "0–7d";
  if (days <= 14) return "8–14d";
  if (days <= 30) return "15–30d";
  return "30d+";
}

// ---------------------------------------------------------------------------
// Card wrapper
// ---------------------------------------------------------------------------

function DashCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        "rounded-xl border border-rule bg-card p-6",
        className
      )}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Hero summary card
// ---------------------------------------------------------------------------

function HeroCard({
  openCount,
  pendingCount,
  overdueCount,
  seriesCount,
  meetings,
}: {
  openCount: number;
  pendingCount: number;
  overdueCount: number;
  seriesCount: number;
  meetings: { id: string; title: string; sequence_number: number; series_id: string; date: Date; issues_raised: number; issues_resolved: number }[];
}) {
  const recentMeetings = meetings.slice(-8);
  const maxIssues = Math.max(1, ...recentMeetings.map((m) => m.issues_raised + m.issues_resolved));
  const avgLife = openCount > 0
    ? Math.round(
        (meetings ?? []).reduce((acc, m) => acc + m.issues_raised, 0) /
          Math.max(1, openCount)
      )
    : 0;

  return (
    <DashCard className="col-span-2">
      <p className="text-[11px] font-mono uppercase tracking-wider text-ink-4 mb-3">
        {formatWeekday(new Date())}
      </p>
      <div className="flex items-baseline gap-4 mb-2">
        <span className="font-display text-5xl font-bold text-ink tabular-nums leading-none">
          {openCount}
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink leading-tight">
            Open items across your series
          </h2>
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm text-ink-2 mt-1">
        <span>{openCount} open</span>
        <span className="text-ink-4">·</span>
        <span>{pendingCount} pending</span>
        {overdueCount > 0 && (
          <>
            <span className="text-ink-4">·</span>
            <span className="text-accent font-medium">{overdueCount} overdue</span>
          </>
        )}
        <span className="text-ink-4">·</span>
        <span>{seriesCount} series</span>
      </div>

      {recentMeetings.length > 0 && (
        <div className="mt-6 pt-5 border-t border-rule">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-ink-3">
              Issues across last {recentMeetings.length} meetings
            </p>
            {avgLife > 0 && (
              <p className="text-xs text-ink-4">
                avg life <span className="font-semibold text-ink-2">{avgLife} days</span>
              </p>
            )}
          </div>
          <div className="flex items-end gap-2 h-24">
            {recentMeetings.map((m, idx) => {
              const raised = m.issues_raised;
              const resolved = m.issues_resolved;
              const total = raised + resolved;
              const height = total > 0 ? (total / maxIssues) * 100 : 4;
              const resolvedPct = total > 0 ? (resolved / total) * 100 : 0;
              const isLast = idx === recentMeetings.length - 1;

              return (
                <div key={m.id} className="flex-1 flex flex-col items-center gap-1.5">
                  <div
                    className="w-full rounded-sm overflow-hidden relative"
                    style={{ height: `${height}%`, minHeight: 3 }}
                  >
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-success/80 rounded-sm"
                      style={{ height: `${resolvedPct}%` }}
                    />
                    <div
                      className={cn(
                        "absolute top-0 left-0 right-0 rounded-sm",
                        isLast ? "bg-accent" : "bg-ink/20"
                      )}
                      style={{ height: `${100 - resolvedPct}%` }}
                    />
                  </div>
                  <span className={cn(
                    "text-[10px] font-mono tabular-nums",
                    isLast ? "text-accent font-medium" : "text-ink-4"
                  )}>
                    M-{m.sequence_number}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-ink/20" />
              <span className="text-[10px] text-ink-4">Raised</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-success/80" />
              <span className="text-[10px] text-ink-4">Resolved</span>
            </div>
          </div>
        </div>
      )}
    </DashCard>
  );
}

// ---------------------------------------------------------------------------
// Next meeting card
// ---------------------------------------------------------------------------

function NextMeetingCard({
  seriesList,
}: {
  seriesList: (MeetingSeries & { open_issues_count: number })[];
}) {
  const nextSeries = seriesList[0];
  if (!nextSeries) return null;

  return (
    <DashCard>
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
          <span className="size-1.5 rounded-full bg-accent animate-pulse" />
          Next meeting
        </span>
      </div>
      <h3 className="font-display text-lg font-semibold text-ink mb-1">
        {nextSeries.name}
      </h3>
      <p className="text-sm text-ink-2 capitalize mb-4">
        {nextSeries.cadence === "adhoc" ? "Ad hoc" : nextSeries.cadence}
      </p>
      {nextSeries.open_issues_count > 0 && (
        <p className="text-sm text-ink-2 mb-5">
          <span className="text-accent font-medium">{nextSeries.open_issues_count} items pending</span> from last meeting.
        </p>
      )}
      <div className="flex items-center gap-3">
        <Link href={`/series/${nextSeries.id}`}>
          <Button className="bg-ink text-paper hover:bg-ink-2 flex-1 h-10">
            Open series
            <ArrowRight className="size-3.5 ml-1.5" />
          </Button>
        </Link>
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------------------
// Outstanding items (grouped by series)
// ---------------------------------------------------------------------------

function OutstandingItems({
  issues,
  seriesMap,
  seriesList,
  onStatusChange,
}: {
  issues: Issue[];
  seriesMap: Map<string, MeetingSeries & { open_issues_count: number }>;
  seriesList: (MeetingSeries & { open_issues_count: number })[];
  onStatusChange: (issueId: string, oldStatus: IssueStatus, newStatus: IssueStatus, seriesId: string) => void;
}) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<"all" | "open" | "pending" | "overdue">("all");
  const [focusedIdx, setFocusedIdx] = React.useState(-1);

  const openIssues = issues.filter(isOpen);

  const filtered = openIssues.filter((issue) => {
    if (filter === "open") return issue.status === "open";
    if (filter === "pending") return issue.status === "pending";
    if (filter === "overdue") return isOverdue(issue);
    return true;
  });

  const grouped = new Map<string, Issue[]>();
  for (const issue of filtered) {
    const existing = grouped.get(issue.series_id) ?? [];
    existing.push(issue);
    grouped.set(issue.series_id, existing);
  }

  const sortedPriority = (a: Issue, b: Issue) =>
    PRIORITY_CONFIG[a.priority].order - PRIORITY_CONFIG[b.priority].order;

  // Flat list of visible issues for keyboard nav
  const flatIssues = React.useMemo(() => {
    const result: Issue[] = [];
    for (const series of seriesList) {
      const seriesIssues = (grouped.get(series.id) ?? []).sort(sortedPriority);
      result.push(...seriesIssues);
    }
    return result;
  }, [filtered, seriesList]);

  React.useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx((prev) => Math.min(prev + 1, flatIssues.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && focusedIdx >= 0 && focusedIdx < flatIssues.length) {
        e.preventDefault();
        router.push(`/issues/${flatIssues[focusedIdx].id}`);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [flatIssues, focusedIdx, router]);

  // Reset focus when filter changes
  React.useEffect(() => { setFocusedIdx(-1); }, [filter]);

  const filters = [
    { key: "all" as const, label: "All" },
    { key: "open" as const, label: "Open" },
    { key: "pending" as const, label: "Pending" },
    { key: "overdue" as const, label: "Overdue" },
  ];

  return (
    <DashCard className="col-span-2">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display text-lg font-semibold text-ink">Outstanding items</h3>
        <div className="flex items-center gap-1">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-ink text-paper"
                  : "bg-paper-2 text-ink-3 hover:text-ink-2"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-ink-4 mb-5">Grouped by series</p>

      <div className="space-y-6">
        {seriesList.map((series) => {
          const seriesIssues = (grouped.get(series.id) ?? []).sort(sortedPriority);
          if (seriesIssues.length === 0 && filter !== "all") return null;

          return (
            <div key={series.id}>
              <div className="flex items-center gap-3 mb-3">
                <span className="size-2 rounded-full bg-accent" />
                <Link
                  href={`/series/${series.id}`}
                  className="text-sm font-semibold text-ink hover:text-accent transition-colors"
                >
                  {series.name}
                </Link>
                <span className="text-xs text-ink-4 capitalize">
                  {series.cadence === "adhoc" ? "Ad hoc" : series.cadence}
                </span>
                <span className="ml-auto text-xs text-ink-4 tabular-nums">
                  {seriesIssues.length} item{seriesIssues.length !== 1 ? "s" : ""}
                </span>
              </div>

              {seriesIssues.length === 0 ? (
                <p className="text-xs text-ink-4 pl-5 mb-2">No matching items</p>
              ) : (
                <div className="space-y-1">
                  {seriesIssues.map((issue, idx) => {
                    const globalIdx = flatIssues.indexOf(issue);
                    return (
                      <IssueRow
                        key={issue.id}
                        issue={issue}
                        index={idx}
                        focused={globalIdx === focusedIdx}
                        onStatusChange={onStatusChange}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}

function IssueRow({
  issue,
  index,
  focused,
  onStatusChange,
}: {
  issue: Issue;
  index: number;
  focused?: boolean;
  onStatusChange: (issueId: string, oldStatus: IssueStatus, newStatus: IssueStatus, seriesId: string) => void;
}) {
  const overdue = isOverdue(issue);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focused]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      data-focused={focused || undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
        focused ? "bg-paper-2 ring-1 ring-accent/30" : "hover:bg-paper-2"
      )}
    >
      <CategoryBadge category={issue.category} size="sm" />
      <Link
        href={`/issues/${issue.id}`}
        className="flex-1 min-w-0 text-sm font-medium text-ink group-hover:text-accent transition-colors truncate"
      >
        {issue.title}
      </Link>
      <StatusChip
        status={issue.status}
        onChange={(newStatus) => onStatusChange(issue.id, issue.status, newStatus, issue.series_id)}
      />
      {issue.owner_name && (
        <span className="hidden sm:inline-flex items-center justify-center size-6 rounded-full bg-paper-3 text-[10px] font-medium text-ink shrink-0" title={issue.owner_name}>
          {issue.owner_name.charAt(0).toUpperCase()}
        </span>
      )}
      {issue.due_date && (
        <span className={cn("text-xs tabular-nums shrink-0", overdue ? "text-accent font-medium" : "text-ink-4")}>
          {overdue ? "Due " : ""}{formatShortDate(issue.due_date)}
        </span>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Age of open items card
// ---------------------------------------------------------------------------

function AgeCard({ issues }: { issues: Issue[] }) {
  const openIssues = issues.filter(isOpen);
  const buckets = new Map<string, number>();
  const order = ["0–7d", "8–14d", "15–30d", "30d+"];
  for (const key of order) buckets.set(key, 0);

  for (const issue of openIssues) {
    const age = daysBetween(issue.created_at, new Date());
    const group = ageGroup(age);
    buckets.set(group, (buckets.get(group) ?? 0) + 1);
  }

  const dotColor = (key: string) => {
    switch (key) {
      case "0–7d": return "bg-success";
      case "8–14d": return "bg-accent";
      case "15–30d": return "bg-warn";
      default: return "bg-ink-4";
    }
  };

  const maxAge = openIssues.length > 0
    ? Math.max(...openIssues.map((i) => daysBetween(i.created_at, new Date())))
    : 0;

  return (
    <DashCard>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-base font-semibold text-ink">Age of open items</h3>
        <span className="text-[11px] text-ink-4">oldest first</span>
      </div>
      {maxAge > 0 && (
        <p className="text-xs text-ink-3 mb-4">
          Oldest issue is <span className="text-ink font-medium">{maxAge} days</span> old.
        </p>
      )}
      <div className="space-y-2.5">
        {order.map((key) => (
          <div key={key} className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className={cn("size-2 rounded-full", dotColor(key))} />
              <span className="text-sm text-ink-2">{key}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-display text-base font-semibold text-ink tabular-nums">{buckets.get(key)}</span>
              <span className="text-xs text-ink-4 w-10 text-right">item{buckets.get(key) !== 1 ? "s" : ""}</span>
            </div>
          </div>
        ))}
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------------------
// Series summary card
// ---------------------------------------------------------------------------

function SeriesQuickList({
  seriesList,
}: {
  seriesList: (MeetingSeries & { open_issues_count: number })[];
}) {
  return (
    <DashCard>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-base font-semibold text-ink">Your series</h3>
        <Link href="/series" className="text-xs text-ink-3 hover:text-accent transition-colors">
          View all
        </Link>
      </div>
      <div className="space-y-1">
        {seriesList.map((series, idx) => (
          <Link
            key={series.id}
            href={`/series/${series.id}`}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-paper-2 transition-colors group"
          >
            <Calendar className="size-4 text-ink-4 group-hover:text-accent transition-colors" />
            <span className="flex-1 text-sm text-ink group-hover:text-accent transition-colors">{series.name}</span>
            {series.open_issues_count > 0 && (
              <span className="text-xs text-accent font-medium tabular-nums">
                {series.open_issues_count} open
              </span>
            )}
          </Link>
        ))}
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------------------
// Quick-add floating button
// ---------------------------------------------------------------------------

function QuickAddButton({
  seriesList,
}: {
  seriesList: (MeetingSeries & { open_issues_count: number })[];
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [selectedSeriesId, setSelectedSeriesId] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const createIssue = useCreateIssue();

  const { data: meetings } = useMeetings(selectedSeriesId);
  const latestMeetingId = React.useMemo(() => {
    if (!meetings?.length) return null;
    const sorted = [...meetings].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return sorted[0].id;
  }, [meetings]);

  React.useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  React.useEffect(() => {
    if (seriesList.length > 0 && !selectedSeriesId) {
      setSelectedSeriesId(seriesList[0].id);
    }
  }, [seriesList, selectedSeriesId]);

  // N key shortcut
  React.useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !selectedSeriesId || !latestMeetingId) return;

    createIssue.mutate(
      {
        title: title.trim(),
        category: "action",
        priority: "medium",
        meeting_id: latestMeetingId,
        series_id: selectedSeriesId,
      },
      {
        onSuccess: () => {
          setTitle("");
          setOpen(false);
        },
      }
    );
  }

  return (
    <>
      {/* FAB */}
      <motion.button
        type="button"
        aria-label="Quick add issue"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center justify-center size-12 rounded-full shadow-lg transition-colors",
          open
            ? "bg-ink text-paper"
            : "bg-accent text-white hover:bg-accent-hover"
        )}
        whileTap={{ scale: 0.9 }}
      >
        {open ? <X className="size-5" /> : <Plus className="size-5" />}
      </motion.button>

      {/* Popover form */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-20 right-6 z-50 w-80 rounded-xl border border-rule bg-card p-4 shadow-xl"
          >
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <select
                value={selectedSeriesId}
                onChange={(e) => setSelectedSeriesId(e.target.value)}
                className="w-full rounded-md border border-rule bg-paper px-3 py-1.5 text-sm text-ink"
              >
                {seriesList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                ref={inputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New issue title..."
                className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setOpen(false);
                  }
                }}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!title.trim() || !latestMeetingId || createIssue.isPending}
                className="bg-accent text-white hover:bg-accent-hover self-end"
              >
                {createIssue.isPending ? "Adding..." : "Add issue"}
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-5">
      <Skeleton className="h-40 col-span-2 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-80 col-span-2 rounded-xl" />
      <div className="space-y-5">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { data: issues, isLoading: issuesLoading } = useIssues();
  const { data: seriesList, isLoading: seriesLoading } = useSeries();
  const { data: meetings, isLoading: meetingsLoading } = useAllMeetings();
  const updateStatus = useUpdateIssueStatus();

  const isLoading = issuesLoading || seriesLoading || meetingsLoading;

  const seriesMap = React.useMemo(() => {
    const map = new Map<string, MeetingSeries & { open_issues_count: number }>();
    for (const s of seriesList ?? []) map.set(s.id, s);
    return map;
  }, [seriesList]);

  const openCount = React.useMemo(
    () => (issues ?? []).filter((i) => i.status === "open").length,
    [issues]
  );
  const pendingCount = React.useMemo(
    () => (issues ?? []).filter((i) => i.status === "pending").length,
    [issues]
  );
  const overdueCount = React.useMemo(
    () => (issues ?? []).filter(isOverdue).length,
    [issues]
  );

  function handleStatusChange(issueId: string, oldStatus: IssueStatus, newStatus: IssueStatus, seriesId: string) {
    updateStatus.mutate({ issueId, seriesId, oldStatus, newStatus });
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {isLoading ? (
          <DashboardSkeleton />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Row 1: Hero + Next meeting */}
            <HeroCard
              openCount={openCount}
              pendingCount={pendingCount}
              overdueCount={overdueCount}
              seriesCount={seriesList?.length ?? 0}
              meetings={meetings ?? []}
            />
            <NextMeetingCard seriesList={seriesList ?? []} />

            {/* Row 2: Outstanding items + sidebar */}
            <OutstandingItems
              issues={issues ?? []}
              seriesMap={seriesMap}
              seriesList={seriesList ?? []}
              onStatusChange={handleStatusChange}
            />
            <div className="space-y-5">
              <SeriesQuickList seriesList={seriesList ?? []} />
              <AgeCard issues={issues ?? []} />
            </div>
          </div>
        )}
        <QuickAddButton seriesList={seriesList ?? []} />
      </div>
    </div>
  );
}
