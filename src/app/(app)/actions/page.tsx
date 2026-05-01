"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useIssues, useUpdateIssueStatus } from "@/lib/hooks/use-issues";
import { useSeries } from "@/lib/hooks/use-series";
import { useProfile } from "@/lib/hooks/use-profile";
import { PRIORITY_CONFIG } from "@/lib/constants";
import { IssueCard, EmptyState } from "@/components/minutia";
import { Skeleton } from "@/components/ui/skeleton";
import type { Issue, IssueStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isOverdue(issue: Issue): boolean {
  if (issue.status === "resolved" || issue.status === "dropped") return false;
  if (!issue.due_date) return false;
  return new Date(issue.due_date) < new Date();
}

function sortByPriorityThenDue(a: Issue, b: Issue): number {
  const pDiff =
    PRIORITY_CONFIG[a.priority].order - PRIORITY_CONFIG[b.priority].order;
  if (pDiff !== 0) return pDiff;
  const aDue = a.due_date ? new Date(a.due_date).getTime() : Infinity;
  const bDue = b.due_date ? new Date(b.due_date).getTime() : Infinity;
  return aDue - bDue;
}

// ---------------------------------------------------------------------------
// Section (collapsible group)
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  staggerOffset: number;
}

function Section({
  title,
  count,
  defaultOpen = true,
  children,
  staggerOffset,
}: SectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 mb-3 group cursor-pointer"
      >
        <ChevronDown
          className={`size-3.5 text-ink-3 transition-transform duration-200 ${
            open ? "" : "-rotate-90"
          }`}
        />
        <h2 className="text-xs font-mono font-medium uppercase tracking-wider text-ink-3">
          {title}
        </h2>
        <span className="text-xs font-mono text-ink-4 tabular-nums">{count}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ActionsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
      <div className="space-y-3 mt-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Actions page
// ---------------------------------------------------------------------------

export default function MyActionsPage() {
  const { data: issues, isLoading: issuesLoading } = useIssues();
  const { data: seriesList, isLoading: seriesLoading } = useSeries();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const updateStatus = useUpdateIssueStatus();

  const [expandedIssueId, setExpandedIssueId] = React.useState<string | null>(
    null,
  );

  // Build series name map
  const seriesMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const s of seriesList ?? []) {
      map.set(s.id, s.name);
    }
    return map;
  }, [seriesList]);

  // Filter issues relevant to the current user
  const myIssues = React.useMemo(() => {
    if (!issues || !profile) return [];
    return issues.filter(
      (i) => i.owner_user_id === profile.id,
    );
  }, [issues, profile]);

  // Group into sections
  const { needsAttention, pending, completed } = React.useMemo(() => {
    const needsAttention: Issue[] = [];
    const pending: Issue[] = [];
    const completed: Issue[] = [];

    for (const issue of myIssues) {
      if (issue.status === "resolved" || issue.status === "dropped") {
        completed.push(issue);
      } else if (issue.status === "pending") {
        pending.push(issue);
      } else {
        // open + in_progress
        needsAttention.push(issue);
      }
    }

    needsAttention.sort(sortByPriorityThenDue);
    pending.sort(sortByPriorityThenDue);
    completed.sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

    return { needsAttention, pending, completed };
  }, [myIssues]);

  // Counts for summary line
  const openCount = needsAttention.length;
  const pendingCount = pending.length;
  const overdueCount = React.useMemo(
    () => myIssues.filter(isOverdue).length,
    [myIssues],
  );

  // Handlers
  function handleStatusChange(issueId: string, newStatus: IssueStatus) {
    const issue = myIssues.find((i) => i.id === issueId);
    if (!issue) return;
    updateStatus.mutate({
      issueId,
      seriesId: issue.series_id,
      oldStatus: issue.status,
      newStatus,
    });
  }

  function handleExpand(issueId: string) {
    setExpandedIssueId((prev) => (prev === issueId ? null : issueId));
  }

  const isLoading = issuesLoading || seriesLoading || profileLoading;
  const isEmpty = !isLoading && myIssues.length === 0;

  // Render helper for an issue card with series tag and stagger animation
  function renderIssueCard(issue: Issue, globalIndex: number) {
    const seriesName = seriesMap.get(issue.series_id);

    return (
      <motion.div
        key={issue.id}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{
          delay: globalIndex * 0.06,
          duration: 0.32,
          ease: [0.2, 0.8, 0.2, 1],
        }}
      >
        <div>
          {seriesName && (
            <div className="mb-1 ml-1">
              <span className="inline-flex items-center rounded-full bg-paper-2 border border-rule px-2 py-0.5 text-[10px] font-medium text-ink-3">
                {seriesName}
              </span>
            </div>
          )}
          <IssueCard
            issue={issue}
            onStatusChange={handleStatusChange}
            onExpand={handleExpand}
            expanded={expandedIssueId === issue.id}
          />
        </div>
      </motion.div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink tracking-tight">
            My Actions
          </h1>
          {!isLoading && myIssues.length > 0 && (
            <p className="mt-1.5 text-sm text-ink-2">
              {openCount > 0 && <span>{openCount} OPEN</span>}
              {pendingCount > 0 && (
                <span>
                  {openCount > 0 ? " · " : ""}
                  {pendingCount} PENDING
                </span>
              )}
              {overdueCount > 0 && (
                <span className="text-accent">
                  {openCount > 0 || pendingCount > 0 ? " · " : ""}
                  {overdueCount} OVERDUE
                </span>
              )}
            </p>
          )}
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="mt-8">
            <ActionsSkeleton />
          </div>
        )}

        {/* Empty state */}
        {isEmpty && <EmptyState variant="no-actions" />}

        {/* Main content */}
        {!isLoading && !isEmpty && (
          <div className="mt-6 space-y-8">
            {/* Needs Attention */}
            {needsAttention.length > 0 && (
              <Section
                title="Needs attention"
                count={needsAttention.length}
                defaultOpen={true}
                staggerOffset={0}
              >
                <div className="space-y-3">
                  {needsAttention.map((issue, index) =>
                    renderIssueCard(issue, index),
                  )}
                </div>
              </Section>
            )}

            {/* Pending */}
            {pending.length > 0 && (
              <Section
                title="Pending"
                count={pending.length}
                defaultOpen={true}
                staggerOffset={needsAttention.length}
              >
                <div className="space-y-3">
                  {pending.map((issue, index) =>
                    renderIssueCard(issue, needsAttention.length + index),
                  )}
                </div>
              </Section>
            )}

            {/* Completed (collapsed by default) */}
            {completed.length > 0 && (
              <Section
                title="Completed"
                count={completed.length}
                defaultOpen={false}
                staggerOffset={needsAttention.length + pending.length}
              >
                <div className="space-y-3">
                  {completed.map((issue, index) =>
                    renderIssueCard(
                      issue,
                      needsAttention.length + pending.length + index,
                    ),
                  )}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
