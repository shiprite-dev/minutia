"use client";

import * as React from "react";
import Link from "next/link";
import { WidgetShell } from "./widget-shell";
import { StatusChip } from "@/components/minutia/status-chip";
import { CategoryBadge } from "@/components/minutia/category-badge";
import { cn } from "@/lib/utils";
import type { Issue, IssueStatus, MeetingSeries } from "@/lib/types";

function isOverdue(issue: Issue): boolean {
  if (issue.status === "resolved" || issue.status === "dropped") return false;
  if (!issue.due_date) return false;
  return new Date(issue.due_date) < new Date();
}

interface OwnerGroup {
  name: string;
  issues: Issue[];
  overdueCount: number;
}

export function WorkloadWidget({
  id,
  index,
  issues,
  seriesList,
  onStatusChange,
}: {
  id: string;
  index: number;
  issues: Issue[];
  seriesList: (MeetingSeries & { open_issues_count: number })[];
  onStatusChange: (issueId: string, oldStatus: IssueStatus, newStatus: IssueStatus, seriesId: string) => void;
}) {
  const [view, setView] = React.useState<"owner" | "series" | "overdue">("owner");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const openIssues = issues.filter(
    (i) => i.status !== "resolved" && i.status !== "dropped"
  );

  const ownerGroups = React.useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of openIssues) {
      const key = issue.owner_name ?? "Unassigned";
      const list = map.get(key) ?? [];
      list.push(issue);
      map.set(key, list);
    }

    const groups: OwnerGroup[] = Array.from(map.entries())
      .map(([name, iss]) => ({
        name,
        issues: iss,
        overdueCount: iss.filter(isOverdue).length,
      }))
      .sort((a, b) => b.issues.length - a.issues.length);

    return groups;
  }, [openIssues]);

  const maxItems = Math.max(1, ...ownerGroups.map((g) => g.issues.length));
  const unassignedCount = ownerGroups.find((g) => g.name === "Unassigned")?.issues.length ?? 0;
  const ownerCount = ownerGroups.filter((g) => g.name !== "Unassigned").length;
  const totalOverdue = openIssues.filter(isOverdue).length;

  const seriesMap = React.useMemo(() => {
    const m = new Map<string, MeetingSeries>();
    for (const s of seriesList) m.set(s.id, s);
    return m;
  }, [seriesList]);

  return (
    <WidgetShell id={id} index={index}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
        <h3 className="font-display text-lg font-semibold text-ink">Workload</h3>
        <div className="flex items-center gap-1" role="tablist">
          {(["owner", "series", "overdue"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
                view === v
                  ? "bg-ink text-paper"
                  : "bg-paper-2 text-ink-3 hover:text-ink-2"
              )}
            >
              {v === "owner" ? "By Owner" : v === "series" ? "By Series" : "Overdue"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-ink-2 mt-1 mb-5">
        <span>{openIssues.length} open</span>
        <span className="text-ink-4">·</span>
        <span>{ownerCount} owners</span>
        {unassignedCount > 0 && (
          <>
            <span className="text-ink-4">·</span>
            <span className="text-accent font-medium">{unassignedCount} unassigned</span>
          </>
        )}
        {totalOverdue > 0 && (
          <>
            <span className="text-ink-4">·</span>
            <span className="text-accent font-medium">{totalOverdue} overdue</span>
          </>
        )}
      </div>

      {/* Balance bars */}
      {view === "owner" && (
        <div className="space-y-2 mb-6">
          {ownerGroups.map((group) => (
            <div key={group.name} className="flex items-center gap-3">
              <span
                className={cn(
                  "w-20 text-sm truncate text-right",
                  group.name === "Unassigned" ? "text-accent" : "text-ink-2"
                )}
              >
                {group.name}
              </span>
              <div className="flex-1 h-2 rounded-full bg-paper-2 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full",
                    group.name === "Unassigned" ? "bg-accent" : "bg-ink-3"
                  )}
                  style={{ width: `${(group.issues.length / maxItems) * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono text-ink-4 tabular-nums w-5 text-right">
                {group.issues.length}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Item list */}
      <div className="space-y-4">
        {ownerGroups.map((group) => {
          const isExpanded = expanded.has(group.name);
          const visible = isExpanded ? group.issues : group.issues.slice(0, 2);
          const hiddenCount = group.issues.length - 2;

          return (
            <div key={group.name}>
              <div className="flex items-center gap-2 mb-2">
                {group.name !== "Unassigned" ? (
                  <span className="inline-flex items-center justify-center size-6 rounded-full bg-paper-3 text-[10px] font-medium text-ink">
                    {group.name.charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <span className="inline-flex items-center justify-center size-6 rounded-full bg-accent-soft text-[10px] font-medium text-accent">
                    ?
                  </span>
                )}
                <span className={cn("text-sm font-semibold", group.name === "Unassigned" ? "text-accent" : "text-ink")}>
                  {group.name}
                </span>
                <span className="text-xs text-ink-4">{group.issues.length} items</span>
                {group.overdueCount > 0 && (
                  <span className="ml-auto text-xs font-medium text-accent tabular-nums">
                    {group.overdueCount} overdue
                  </span>
                )}
                {group.overdueCount === 0 && (
                  <span className="ml-auto text-xs text-ink-4">0 overdue</span>
                )}
              </div>

              <div className="space-y-1">
                {visible.map((issue) => (
                  <div
                    key={issue.id}
                    className="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 hover:bg-paper-2 transition-colors"
                  >
                    <CategoryBadge category={issue.category} size="sm" />
                    <Link
                      href={`/issues/${issue.id}`}
                      className="flex-1 min-w-0 text-sm font-medium text-ink group-hover:text-accent transition-colors truncate basis-[120px]"
                    >
                      {issue.title}
                    </Link>
                    <span className="text-[11px] text-ink-4">
                      {seriesMap.get(issue.series_id)?.name}
                    </span>
                    <StatusChip
                      status={issue.status}
                      onChange={(s) => onStatusChange(issue.id, issue.status, s, issue.series_id)}
                    />
                    {issue.due_date && (() => {
                      const over = isOverdue(issue);
                      return (
                        <span className={cn("text-xs font-mono tabular-nums shrink-0", over ? "text-accent font-medium" : "text-ink-4")}>
                          {over ? `Overdue ${Math.abs(Math.round((new Date(issue.due_date).getTime() - Date.now()) / 86400000))}d` : `Due ${new Date(issue.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                        </span>
                      );
                    })()}
                  </div>
                ))}
                {hiddenCount > 0 && !isExpanded && (
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => new Set(prev).add(group.name))}
                    className="text-xs font-medium text-ink-3 hover:text-accent transition-colors pl-3 pt-1 cursor-pointer"
                  >
                    +{hiddenCount} more · Show all
                  </button>
                )}
                {isExpanded && hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        next.delete(group.name);
                        return next;
                      });
                    }}
                    className="text-xs font-medium text-ink-3 hover:text-accent transition-colors pl-3 pt-1 cursor-pointer"
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
