"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  Plus,
} from "lucide-react";
import {
  useIssues,
  useUpdateIssueStatus,
} from "@/lib/hooks/use-issues";
import { useSeries } from "@/lib/hooks/use-series";
import { useAllMeetings } from "@/lib/hooks/use-meetings";
import { useDecisions } from "@/lib/hooks/use-decisions";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import { StatusChip } from "@/components/minutia/status-chip";
import { CategoryBadge } from "@/components/minutia/category-badge";
import { MinutiaCadenceIcon } from "@/components/minutia/minutia-icons";
import { IssueKey } from "@/components/minutia/issue-key";
import { PrefetchIssueLink } from "@/components/minutia/prefetch-issue-link";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { HintTooltip } from "@/components/minutia/hint-tooltip";
import { cn } from "@/lib/utils";
import { formatShortDate, daysBetween } from "@/lib/date-utils";
import { isOpen, isOverdue } from "@/lib/issue-utils";
import { useWidgetStore } from "@/lib/stores/widget-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { WidgetShell } from "@/components/minutia/widgets/widget-shell";
import { WidgetCanvas } from "@/components/minutia/widgets/widget-canvas";
import { AddWidgetButton } from "@/components/minutia/widgets/add-widget";
import { StaleItemsWidget } from "@/components/minutia/widgets/stale-items-widget";
import { SeriesHealthWidget } from "@/components/minutia/widgets/series-health-widget";
import { MeetingTriageWidget } from "@/components/minutia/widgets/meeting-triage-widget";
import { WorkloadWidget } from "@/components/minutia/widgets/workload-widget";
import { useCalendarEvents } from "@/lib/hooks/use-google-calendar";
import { useIssueLimit } from "@/lib/hooks/use-issue-limit";
import { ITEM_LIMIT } from "@/lib/hooks/use-issues";
import type {
  Issue,
  IssueStatus,
  MeetingSeries,
  Decision,
  GoogleCalendarEvent,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeDue(date: Date | string): { label: string; overdue: boolean } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(date);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return { label: `Overdue by ${absDays}d`, overdue: true };
  }
  if (diffDays === 0) return { label: "Due today", overdue: false };
  if (diffDays === 1) return { label: "Due tomorrow", overdue: false };
  if (diffDays <= 7) return { label: `Due in ${diffDays}d`, overdue: false };
  return { label: `Due ${formatShortDate(date)}`, overdue: false };
}

function formatWeekday(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();
}

function ageGroup(days: number): string {
  if (days <= 7) return "0–7d";
  if (days <= 14) return "8–14d";
  if (days <= 30) return "15–30d";
  return "30d+";
}

// ---------------------------------------------------------------------------
// Hero summary widget
// ---------------------------------------------------------------------------

function HeroWidget({
  id,
  widgetIndex,
  openCount,
  pendingCount,
  overdueCount,
  seriesCount,
  meetings,
}: {
  id: string;
  widgetIndex: number;
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
    <WidgetShell id={id} index={widgetIndex}>
      <p className="text-[11px] font-mono uppercase tracking-wider text-ink-4 mb-3">
        {formatWeekday(new Date())}
      </p>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 mb-2">
        <span className="font-display text-5xl font-bold text-ink tabular-nums leading-none">
          {openCount}
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink leading-tight">
            Open items across your series
          </h2>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2 mt-1">
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
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
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
    </WidgetShell>
  );
}

// ---------------------------------------------------------------------------
// Next meeting widget
// ---------------------------------------------------------------------------

function NextMeetingWidget({
  id,
  widgetIndex,
  seriesList,
  calendarEvents,
}: {
  id: string;
  widgetIndex: number;
  seriesList: (MeetingSeries & { open_issues_count: number })[];
  calendarEvents?: GoogleCalendarEvent[];
}) {
  const nextSeries = seriesList[0];
  if (!nextSeries) return null;

  const nextEvent = calendarEvents?.[0];
  const eventTime = nextEvent?.start?.dateTime
    ? new Date(nextEvent.start.dateTime)
    : nextEvent?.start?.date
      ? new Date(nextEvent.start.date)
      : null;

  return (
    <WidgetShell id={id} index={widgetIndex}>
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
          <span className="size-1.5 rounded-full bg-accent animate-pulse" />
          Next meeting
        </span>
      </div>
      <h3 className="font-display text-lg font-semibold text-ink mb-1 break-words">
        {nextSeries.name}
      </h3>
      {eventTime ? (
        <div className="mb-4">
          <p className="text-sm font-medium text-ink-2">
            {eventTime.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            {nextEvent?.start?.dateTime && (
              <span className="text-ink-3">
                {" "}at {eventTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </p>
          {nextEvent?.summary && nextEvent.summary !== nextSeries.name && (
            <p className="text-xs text-ink-3 mt-0.5 truncate">{nextEvent.summary}</p>
          )}
        </div>
      ) : (
        <p className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-2 capitalize">
          <MinutiaCadenceIcon cadence={nextSeries.cadence} className="size-3.5 text-ink" />
          {nextSeries.cadence === "adhoc" ? "Ad hoc" : nextSeries.cadence}
        </p>
      )}
      {nextSeries.open_issues_count > 0 && (
        <p className="text-sm text-ink-2 mb-5">
          <span className="text-accent font-medium"><span className="font-mono">{nextSeries.open_issues_count}</span> items pending</span> from last meeting.
        </p>
      )}
      <div className="flex items-center gap-3">
        <Link href={`/series/${nextSeries.id}`} className="w-full">
          <Button className="w-full bg-ink text-paper hover:bg-ink-2 h-10">
            Open series
            <ArrowRight className="size-3.5 ml-1.5" />
          </Button>
        </Link>
      </div>
    </WidgetShell>
  );
}

// ---------------------------------------------------------------------------
// Outstanding items widget
// ---------------------------------------------------------------------------

function OutstandingWidget({
  id,
  widgetIndex,
  issues,
  seriesMap,
  seriesList,
  onStatusChange,
}: {
  id: string;
  widgetIndex: number;
  issues: Issue[];
  seriesMap: Map<string, MeetingSeries & { open_issues_count: number }>;
  seriesList: (MeetingSeries & { open_issues_count: number })[];
  onStatusChange: (issueId: string, oldStatus: IssueStatus, newStatus: IssueStatus, seriesId: string) => void;
}) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<"all" | "open" | "pending" | "overdue">("all");
  const [focusedIdx, setFocusedIdx] = React.useState(-1);
  const [expandedSeries, setExpandedSeries] = React.useState<Set<string>>(new Set());
  const PREVIEW_COUNT = 3;

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

  const flatIssues = React.useMemo(() => {
    const result: Issue[] = [];
    for (const series of seriesList) {
      const seriesIssues = (grouped.get(series.id) ?? []).sort(sortedPriority);
      const visible = expandedSeries.has(series.id)
        ? seriesIssues
        : seriesIssues.slice(0, PREVIEW_COUNT);
      result.push(...visible);
    }
    return result;
  }, [filtered, seriesList, expandedSeries]);

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

  React.useEffect(() => { setFocusedIdx(-1); }, [filter]);

  const filters = [
    { key: "all" as const, label: "All" },
    { key: "open" as const, label: "Open" },
    { key: "pending" as const, label: "Pending" },
    { key: "overdue" as const, label: "Overdue" },
  ];

  return (
    <WidgetShell id={id} index={widgetIndex}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <h3 className="font-display text-lg font-semibold text-ink">Outstanding items</h3>
        <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Filter outstanding items">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors outline-none",
                "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper",
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

      {openIssues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-[13px] text-ink-2">Nothing outstanding. Enjoy the quiet.</p>
          <div className="mt-3 flex gap-1 text-ink-4" aria-hidden="true">
            {"— · — · — · — · —".split("").map((c, i) => (
              <span key={i} className="font-display text-xs">{c}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="divide-y divide-rule">
          {seriesList.map((series) => {
            const seriesIssues = (grouped.get(series.id) ?? []).sort(sortedPriority);
            if (seriesIssues.length === 0 && filter !== "all") return null;

            return (
              <div key={series.id} className="py-5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
                  <MinutiaCadenceIcon cadence={series.cadence} className="size-4 shrink-0 text-ink" />
                  <Link
                    href={`/series/${series.id}`}
                    className="text-sm font-semibold text-ink hover:text-accent transition-colors"
                  >
                    {series.name}
                  </Link>
                  <span className="inline-flex items-center gap-1 text-xs text-ink-4 capitalize">
                    {series.cadence === "adhoc" ? "Ad hoc" : series.cadence}
                  </span>
                  <span className="ml-auto text-xs text-ink-4 tabular-nums">
                    {seriesIssues.length} item{seriesIssues.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {seriesIssues.length === 0 ? (
                  <p className="text-xs text-ink-4 pl-5 mb-2">No matching items</p>
                ) : (() => {
                  const isExpanded = expandedSeries.has(series.id);
                  const visible = isExpanded ? seriesIssues : seriesIssues.slice(0, PREVIEW_COUNT);
                  const hiddenCount = seriesIssues.length - PREVIEW_COUNT;

                  return (
                    <div className="space-y-1.5">
                      {visible.map((issue, idx) => {
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
                      {hiddenCount > 0 && !isExpanded && (
                        <div className="flex items-center gap-3 pl-3 pt-1">
                          <button
                            type="button"
                            onClick={() => setExpandedSeries((prev) => {
                              const next = new Set(prev);
                              next.add(series.id);
                              return next;
                            })}
                            className="text-xs font-medium text-ink-3 hover:text-accent transition-colors cursor-pointer"
                          >
                            +{hiddenCount} more
                          </button>
                          <span className="text-ink-4">·</span>
                          <Link
                            href={`/series/${series.id}`}
                            className="text-xs font-medium text-ink-3 hover:text-accent transition-colors"
                          >
                            View series
                          </Link>
                        </div>
                      )}
                      {isExpanded && hiddenCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedSeries((prev) => {
                            const next = new Set(prev);
                            next.delete(series.id);
                            return next;
                          })}
                          className="text-xs font-medium text-ink-3 hover:text-accent transition-colors pl-3 pt-1 cursor-pointer"
                        >
                          Show less
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
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
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
      data-focused={focused || undefined}
      aria-label={`${issue.title}, ${STATUS_CONFIG[issue.status].label}${overdue ? ", overdue" : ""}`}
      className={cn(
        "group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper",
        focused ? "bg-paper-2 ring-1 ring-accent/30" : "hover:bg-paper-2"
      )}
    >
      <CategoryBadge category={issue.category} size="sm" />
      <IssueKey issue={issue} className="h-5 px-1.5 text-[10px]" />
      <PrefetchIssueLink
        issueId={issue.id}
        className="flex-1 min-w-0 text-sm font-medium text-ink group-hover:text-accent transition-colors truncate basis-[120px]"
      >
        {issue.title}
      </PrefetchIssueLink>
      <div className="ml-auto grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 sm:w-[384px] sm:grid-cols-[132px_32px_84px_116px]">
        <div data-testid="issue-status-lane" className="flex justify-start sm:w-[132px] sm:justify-end">
          <StatusChip
            status={issue.status}
            onChange={(newStatus) => onStatusChange(issue.id, issue.status, newStatus, issue.series_id)}
          />
        </div>
        <div data-testid="issue-assignee-lane" className="hidden size-6 items-center justify-center justify-self-center sm:flex">
          {issue.owner_name ? (
            <HintTooltip label={`Assignee: ${issue.owner_name}`} side="left">
              <button
                type="button"
                aria-label={`Assignee: ${issue.owner_name}`}
                className="flex size-6 items-center justify-center rounded-full bg-paper-3 text-[10px] font-medium text-ink outline-none transition-colors hover:bg-paper-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
              >
                {issue.owner_name.charAt(0).toUpperCase()}
              </button>
            </HintTooltip>
          ) : null}
        </div>
        <div data-testid="issue-update-lane" className="hidden w-[84px] justify-self-end text-right sm:block">
          {(issue.update_count ?? 0) > 0 ? (
            <span className="text-[11px] font-mono text-ink-4 tabular-nums">
              {issue.update_count} update{issue.update_count !== 1 ? "s" : ""}
            </span>
          ) : null}
        </div>
        <div data-testid="issue-due-lane" className="justify-self-end text-right sm:w-[116px]">
          {issue.due_date ? (() => {
            const rel = formatRelativeDue(issue.due_date);
            return (
              <span className={cn("text-xs font-mono tabular-nums", rel.overdue ? "text-accent font-medium" : "text-ink-4")}>
                {rel.label}
              </span>
            );
          })() : null}
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Age card widget
// ---------------------------------------------------------------------------

function AgeWidget({ id, widgetIndex, issues }: { id: string; widgetIndex: number; issues: Issue[] }) {
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
    <WidgetShell id={id} index={widgetIndex}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
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
          <div key={key} className="flex items-center justify-between gap-3">
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
    </WidgetShell>
  );
}

// ---------------------------------------------------------------------------
// Recent decisions widget
// ---------------------------------------------------------------------------

function DecisionsWidget({
  id,
  widgetIndex,
  decisions,
  seriesMap,
}: {
  id: string;
  widgetIndex: number;
  decisions: Decision[];
  seriesMap: Map<string, MeetingSeries & { open_issues_count: number }>;
}) {
  const recent = decisions.slice(0, 5);

  return (
    <WidgetShell id={id} index={widgetIndex}>
      <h3 className="font-display text-base font-semibold text-ink mb-4">
        Recent decisions
      </h3>
      {recent.length === 0 ? (
        <p className="text-xs text-ink-3">No decisions recorded yet.</p>
      ) : (
        <div className="space-y-1">
          {recent.map((d) => {
            const series = seriesMap.get(d.series_id);
            return (
              <div
                key={d.id}
                className="flex items-start gap-2.5 rounded-lg px-3 py-2 hover:bg-paper-2 transition-colors"
              >
                <span className="text-accent text-xs mt-0.5 shrink-0">&#9670;</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{d.title}</p>
                  {series && (
                    <p className="text-[11px] text-ink-4 mt-0.5">{series.name}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}

// ---------------------------------------------------------------------------
// Series quick list widget
// ---------------------------------------------------------------------------

function SeriesWidget({
  id,
  widgetIndex,
  seriesList,
}: {
  id: string;
  widgetIndex: number;
  seriesList: (MeetingSeries & { open_issues_count: number })[];
}) {
  return (
    <WidgetShell id={id} index={widgetIndex}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="font-display text-base font-semibold text-ink">Your series</h3>
        <Link href="/series" className="text-xs text-ink-3 hover:text-accent transition-colors">
          View all
        </Link>
      </div>
      <div className="space-y-1">
        {seriesList.map((series) => (
          <Link
            key={series.id}
            href={`/series/${series.id}`}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-paper-2 transition-colors group min-w-0"
          >
            <Calendar className="size-4 text-ink-4 group-hover:text-accent transition-colors" />
            <span className="flex-1 min-w-0 text-sm text-ink group-hover:text-accent transition-colors break-words">{series.name}</span>
            {series.open_issues_count > 0 && (
              <span className="text-xs text-accent font-medium tabular-nums">
                {series.open_issues_count} open
              </span>
            )}
          </Link>
        ))}
      </div>
    </WidgetShell>
  );
}

// ---------------------------------------------------------------------------
// Quick-add floating button
// ---------------------------------------------------------------------------

function ItemUsageCounter() {
  const { data, isLoading } = useIssueLimit();
  if (isLoading || !data) return null;
  const { activeCount, atLimit } = data;
  return (
    <span
      className={cn(
        "text-xs font-mono tabular-nums",
        atLimit ? "text-accent font-medium" : "text-ink-4"
      )}
      aria-label={`${activeCount} of ${ITEM_LIMIT} items used`}
    >
      {activeCount} / {ITEM_LIMIT}
    </span>
  );
}

function QuickAddButton() {
  const openQuickAddDialog = useUIStore((s) => s.openQuickAddDialog);
  const { data: issueLimit } = useIssueLimit();
  const atLimit = issueLimit?.atLimit ?? false;

  return (
    <HintTooltip
      label={
        atLimit
          ? "Item limit reached for this account."
          : "Quick add an issue from anywhere on the board. Shortcut: N."
      }
    >
      <motion.button
        type="button"
        data-tour="quick-add"
        aria-label="Quick add issue"
        disabled={atLimit}
        onClick={() => openQuickAddDialog()}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center justify-center size-12 rounded-full shadow-lg transition-colors",
          atLimit
            ? "bg-ink-3 text-paper cursor-not-allowed"
            : "bg-accent text-white hover:bg-accent-hover"
        )}
        whileTap={{ scale: 0.9 }}
      >
        <Plus className="size-5" />
      </motion.button>
    </HintTooltip>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-4">
      <Skeleton className="h-40 lg:col-span-2 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-80 lg:col-span-2 rounded-xl" />
      <div className="space-y-5">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widget renderer
// ---------------------------------------------------------------------------

function WidgetRenderer({
  widgetId,
  widgetType,
  widgetIndex,
  issues,
  seriesList,
  seriesMap,
  meetings,
  decisions,
  openCount,
  pendingCount,
  overdueCount,
  onStatusChange,
  calendarEvents,
}: {
  widgetId: string;
  widgetType: string;
  widgetIndex: number;
  issues: Issue[];
  seriesList: (MeetingSeries & { open_issues_count: number })[];
  seriesMap: Map<string, MeetingSeries & { open_issues_count: number }>;
  meetings: (any & { issues_raised: number; issues_resolved: number })[];
  decisions: Decision[];
  openCount: number;
  pendingCount: number;
  overdueCount: number;
  onStatusChange: (issueId: string, oldStatus: IssueStatus, newStatus: IssueStatus, seriesId: string) => void;
  calendarEvents?: GoogleCalendarEvent[];
}) {
  switch (widgetType) {
    case "hero":
      return (
        <HeroWidget
          id={widgetId}
          widgetIndex={widgetIndex}
          openCount={openCount}
          pendingCount={pendingCount}
          overdueCount={overdueCount}
          seriesCount={seriesList.length}
          meetings={meetings}
        />
      );
    case "next-meeting":
      return (
        <NextMeetingWidget
          id={widgetId}
          widgetIndex={widgetIndex}
          seriesList={seriesList}
          calendarEvents={calendarEvents}
        />
      );
    case "outstanding":
      return (
        <OutstandingWidget
          id={widgetId}
          widgetIndex={widgetIndex}
          issues={issues}
          seriesMap={seriesMap}
          seriesList={seriesList}
          onStatusChange={onStatusChange}
        />
      );
    case "series":
      return (
        <SeriesWidget
          id={widgetId}
          widgetIndex={widgetIndex}
          seriesList={seriesList}
        />
      );
    case "decisions":
      return (
        <DecisionsWidget
          id={widgetId}
          widgetIndex={widgetIndex}
          decisions={decisions}
          seriesMap={seriesMap}
        />
      );
    case "age":
      return (
        <AgeWidget
          id={widgetId}
          widgetIndex={widgetIndex}
          issues={issues}
        />
      );
    case "stale-items":
      return (
        <StaleItemsWidget
          id={widgetId}
          index={widgetIndex}
          issues={issues}
        />
      );
    case "series-health":
      return (
        <SeriesHealthWidget
          id={widgetId}
          index={widgetIndex}
          issues={issues}
          seriesList={seriesList}
        />
      );
    case "meeting-triage":
      return (
        <MeetingTriageWidget
          id={widgetId}
          index={widgetIndex}
          issues={issues}
          meetings={meetings}
          seriesList={seriesList}
          onStatusChange={onStatusChange}
        />
      );
    case "workload":
      return (
        <WorkloadWidget
          id={widgetId}
          index={widgetIndex}
          issues={issues}
          seriesList={seriesList}
          onStatusChange={onStatusChange}
        />
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { data: issues, isLoading: issuesLoading } = useIssues();
  const { data: seriesList, isLoading: seriesLoading } = useSeries();
  const { data: meetings, isLoading: meetingsLoading } = useAllMeetings();
  const { data: allDecisions } = useDecisions(undefined, undefined, true, 5);
  const updateStatus = useUpdateIssueStatus();
  const widgets = useWidgetStore((s) => s.widgets);

  const firstSeriesId = seriesList?.[0]?.gcal_sync_enabled ? seriesList[0].id : undefined;
  const { data: calendarEvents } = useCalendarEvents(firstSeriesId);

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

  const sharedProps = {
    issues: issues ?? [],
    seriesList: seriesList ?? [],
    seriesMap,
    meetings: meetings ?? [],
    decisions: allDecisions ?? [],
    openCount,
    pendingCount,
    overdueCount,
    onStatusChange: handleStatusChange,
    calendarEvents: calendarEvents ?? undefined,
  };

  const widgetIds = React.useMemo(() => widgets.map((w) => w.id), [widgets]);

  return (
    <div className="min-h-screen bg-paper" data-tour="oil-board">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-end mb-5">
          <AddWidgetButton />
        </div>
        {isLoading ? (
          <DashboardSkeleton />
        ) : (
          <WidgetCanvas widgetIds={widgetIds}>
            {widgets.map((w, i) => (
              <WidgetRenderer
                key={w.id}
                widgetId={w.id}
                widgetType={w.type}
                widgetIndex={i}
                {...sharedProps}
              />
            ))}
          </WidgetCanvas>
        )}
        <QuickAddButton />
      </div>
    </div>
  );
}
