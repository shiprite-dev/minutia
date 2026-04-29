"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, X } from "lucide-react";
import {
  useIssues,
  useCreateIssue,
  useUpdateIssueStatus,
} from "@/lib/hooks/use-issues";
import { useSeries } from "@/lib/hooks/use-series";
import { useUIStore } from "@/lib/stores/ui-store";
import { PRIORITY_CONFIG, ISSUE_STATUSES } from "@/lib/constants";
import {
  IssueCard,
  FilterBar,
  CaptureInput,
  EmptyState,
} from "@/components/minutia";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  Issue,
  IssueCategory,
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

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getDueGroup(issue: Issue): string {
  if (!issue.due_date) return "No due date";
  const due = new Date(issue.due_date);
  const now = new Date();
  if (due < now && issue.status !== "resolved" && issue.status !== "dropped")
    return "Overdue";
  const weekEnd = endOfWeek(now);
  if (due <= weekEnd) return "Due this week";
  return "Due later";
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

type SortBy = "priority" | "recency" | "age" | "due";

function sortIssues(issues: Issue[], sortBy: SortBy): Issue[] {
  const sorted = [...issues];
  sorted.sort((a, b) => {
    switch (sortBy) {
      case "priority":
        return (
          PRIORITY_CONFIG[a.priority].order - PRIORITY_CONFIG[b.priority].order
        );
      case "recency":
        return (
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      case "age":
        return (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      case "due": {
        const aDue = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const bDue = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return aDue - bDue;
      }
      default:
        return 0;
    }
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

type GroupBy = "series" | "owner" | "priority" | "due" | "none";

interface GroupedSection {
  key: string;
  label: string;
  issues: Issue[];
}

const PRIORITY_GROUP_ORDER = ["critical", "high", "medium", "low"];
const DUE_GROUP_ORDER = [
  "Overdue",
  "Due this week",
  "Due later",
  "No due date",
];

function groupIssues(
  issues: Issue[],
  groupBy: GroupBy,
  seriesMap: Map<string, string>,
): GroupedSection[] {
  if (groupBy === "none") {
    return [{ key: "all", label: "", issues }];
  }

  const groups = new Map<string, Issue[]>();

  for (const issue of issues) {
    let key: string;
    switch (groupBy) {
      case "series":
        key = issue.series_id;
        break;
      case "owner":
        key = issue.owner_name ?? "Unassigned";
        break;
      case "priority":
        key = issue.priority;
        break;
      case "due":
        key = getDueGroup(issue);
        break;
      default:
        key = "all";
    }
    const existing = groups.get(key) ?? [];
    existing.push(issue);
    groups.set(key, existing);
  }

  let orderedKeys: string[];
  switch (groupBy) {
    case "priority":
      orderedKeys = PRIORITY_GROUP_ORDER.filter((k) => groups.has(k));
      break;
    case "due":
      orderedKeys = DUE_GROUP_ORDER.filter((k) => groups.has(k));
      break;
    default:
      orderedKeys = Array.from(groups.keys()).sort();
      break;
  }

  return orderedKeys.map((key) => {
    let label: string;
    switch (groupBy) {
      case "series":
        label = seriesMap.get(key) ?? key;
        break;
      case "priority":
        label =
          PRIORITY_CONFIG[key as keyof typeof PRIORITY_CONFIG]?.label ?? key;
        break;
      default:
        label = key;
        break;
    }
    return { key, label, issues: groups.get(key) ?? [] };
  });
}

// ---------------------------------------------------------------------------
// Series picker (for quick-add when multiple series exist)
// ---------------------------------------------------------------------------

function SeriesPicker({
  series,
  selected,
  onSelect,
}: {
  series: (MeetingSeries & { open_issues_count: number })[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (series.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xs text-ink-3">Series:</span>
      <div className="flex flex-wrap gap-1">
        {series.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
              selected === s.id
                ? "bg-ink text-paper"
                : "bg-paper-2 text-ink-3 hover:text-ink-2 hover:bg-paper-3"
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function BoardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
      <div className="flex gap-2 mt-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      <div className="space-y-3 mt-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OIL Board page
// ---------------------------------------------------------------------------

export default function OILBoard() {
  const { data: issues, isLoading: issuesLoading } = useIssues();
  const { data: seriesList, isLoading: seriesLoading } = useSeries();
  const createIssue = useCreateIssue();
  const updateStatus = useUpdateIssueStatus();

  const statusFilter = useUIStore((s) => s.statusFilter);
  const groupBy = useUIStore((s) => s.groupBy) as GroupBy;
  const sortBy = useUIStore((s) => s.sortBy) as SortBy;
  const setStatusFilter = useUIStore((s) => s.setStatusFilter);
  const setGroupBy = useUIStore((s) => s.setGroupBy);
  const setSortBy = useUIStore((s) => s.setSortBy);

  const [quickAddOpen, setQuickAddOpen] = React.useState(false);
  const [selectedSeriesId, setSelectedSeriesId] = React.useState<string | null>(
    null,
  );
  const [expandedIssueId, setExpandedIssueId] = React.useState<string | null>(
    null,
  );

  // Auto-select first series when data loads
  React.useEffect(() => {
    if (seriesList?.length && !selectedSeriesId) {
      setSelectedSeriesId(seriesList[0].id);
    }
  }, [seriesList, selectedSeriesId]);

  // Keyboard shortcuts: 'n' opens quick-add, Escape closes it
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === "n") {
        e.preventDefault();
        setQuickAddOpen(true);
      }
      if (e.key === "Escape") {
        setQuickAddOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Build series name map for group headers
  const seriesMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const s of seriesList ?? []) {
      map.set(s.id, s.name);
    }
    return map;
  }, [seriesList]);

  // Compute status counts for filter tabs
  const issueCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const status of ISSUE_STATUSES) {
      counts[status] = 0;
    }
    for (const issue of issues ?? []) {
      counts[issue.status] = (counts[issue.status] ?? 0) + 1;
    }
    return counts;
  }, [issues]);

  // Compute overdue count for summary line
  const overdueCount = React.useMemo(() => {
    return (issues ?? []).filter(isOverdue).length;
  }, [issues]);

  // Filter, sort, group pipeline
  const processedSections = React.useMemo(() => {
    let filtered = issues ?? [];

    if (statusFilter) {
      filtered = filtered.filter((i) => i.status === statusFilter);
    }

    const sorted = sortIssues(filtered, sortBy);
    return groupIssues(sorted, groupBy, seriesMap);
  }, [issues, statusFilter, sortBy, groupBy, seriesMap]);

  const totalVisibleCount = processedSections.reduce(
    (acc, section) => acc + section.issues.length,
    0,
  );

  // Quick-add handler
  function handleQuickAdd(text: string, category: IssueCategory) {
    if (!selectedSeriesId) return;

    createIssue.mutate({
      title: text,
      category,
      priority: "medium",
      meeting_id: "",
      series_id: selectedSeriesId,
    });
  }

  // Status change handler (optimistic via the mutation)
  function handleStatusChange(issueId: string, newStatus: IssueStatus) {
    const issue = (issues ?? []).find((i) => i.id === issueId);
    if (!issue) return;
    updateStatus.mutate({
      issueId,
      seriesId: issue.series_id,
      oldStatus: issue.status,
      newStatus,
    });
  }

  // Expand/collapse a card
  function handleExpand(issueId: string) {
    setExpandedIssueId((prev) => (prev === issueId ? null : issueId));
  }

  const isLoading = issuesLoading || seriesLoading;
  const isEmpty = !isLoading && (!issues || issues.length === 0);
  const hasNoSeries = !isLoading && (!seriesList || seriesList.length === 0);

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-ink tracking-tight">
              Outstanding
            </h1>
            {!isLoading && issues && issues.length > 0 && (
              <p className="mt-1.5 text-sm text-ink-2">
                {issueCounts.open > 0 && (
                  <span>{issueCounts.open} OPEN</span>
                )}
                {issueCounts.pending > 0 && (
                  <span>
                    {issueCounts.open > 0 ? " · " : ""}
                    {issueCounts.pending} PENDING
                  </span>
                )}
                {overdueCount > 0 && (
                  <span className="text-accent">
                    {issueCounts.open > 0 || issueCounts.pending > 0
                      ? " · "
                      : ""}
                    {overdueCount} OVERDUE
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Quick-add toggle */}
          {!hasNoSeries && (
            <button
              type="button"
              onClick={() => setQuickAddOpen((prev) => !prev)}
              aria-label={quickAddOpen ? "Close quick add" : "Quick add issue"}
              className="flex items-center justify-center size-9 rounded-full bg-accent text-paper hover:bg-accent-hover transition-colors shadow-sm"
            >
              {quickAddOpen ? (
                <X className="size-4" />
              ) : (
                <Plus className="size-4" />
              )}
            </button>
          )}
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="mt-8">
            <BoardSkeleton />
          </div>
        )}

        {/* Empty states */}
        {hasNoSeries && <EmptyState variant="no-series" />}
        {isEmpty && !hasNoSeries && <EmptyState variant="no-issues" />}

        {/* Main content (visible once loaded with data) */}
        {!isLoading && !isEmpty && (
          <div className="mt-6 space-y-6">
            {/* Inline quick-add area */}
            <AnimatePresence>
              {quickAddOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{
                    duration: 0.2,
                    ease: [0.2, 0.8, 0.2, 1],
                  }}
                  className="overflow-hidden"
                >
                  <div className="bg-card border border-rule rounded-md p-4">
                    <SeriesPicker
                      series={seriesList ?? []}
                      selected={selectedSeriesId}
                      onSelect={setSelectedSeriesId}
                    />
                    <CaptureInput
                      onSubmit={handleQuickAdd}
                      onCancel={() => setQuickAddOpen(false)}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Filter / group / sort bar */}
            <FilterBar
              statusFilter={statusFilter}
              groupBy={groupBy}
              sortBy={sortBy}
              issueCounts={issueCounts}
              onStatusFilterChange={setStatusFilter}
              onGroupByChange={(g) => setGroupBy(g as GroupBy)}
              onSortByChange={(s) => setSortBy(s as SortBy)}
            />

            {/* Issue list (or filtered-empty state) */}
            {totalVisibleCount === 0 ? (
              <EmptyState variant="no-actions" />
            ) : (
              <div className="space-y-8">
                {processedSections.map((section) => {
                  if (section.issues.length === 0) return null;

                  // Compute a running offset for the stagger animation
                  let globalIndexOffset = 0;
                  for (const s of processedSections) {
                    if (s.key === section.key) break;
                    globalIndexOffset += s.issues.length;
                  }

                  return (
                    <div key={section.key}>
                      {groupBy !== "none" && section.label && (
                        <h2 className="text-xs font-medium uppercase tracking-wider text-ink-3 mb-3">
                          {section.label}
                          <span className="ml-2 text-ink-4 tabular-nums">
                            {section.issues.length}
                          </span>
                        </h2>
                      )}

                      <div className="space-y-3">
                        {section.issues.map((issue, index) => (
                          <motion.div
                            key={issue.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{
                              delay: (globalIndexOffset + index) * 0.06,
                              duration: 0.32,
                              ease: [0.2, 0.8, 0.2, 1],
                            }}
                          >
                            <IssueCard
                              issue={issue}
                              onStatusChange={handleStatusChange}
                              onExpand={handleExpand}
                              expanded={expandedIssueId === issue.id}
                            />
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
