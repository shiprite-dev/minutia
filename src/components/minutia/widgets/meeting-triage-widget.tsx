"use client";

import * as React from "react";
import Link from "next/link";
import { WidgetShell } from "./widget-shell";
import { StatusChip } from "@/components/minutia/status-chip";
import { CategoryBadge } from "@/components/minutia/category-badge";
import { cn } from "@/lib/utils";
import type { Issue, IssueStatus, Meeting, MeetingSeries } from "@/lib/types";

function daysSince(date: Date | string): number {
  const ms = Date.now() - new Date(date).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function MeetingTriageWidget({
  id,
  index,
  issues,
  meetings,
  seriesList,
  onStatusChange,
}: {
  id: string;
  index: number;
  issues: Issue[];
  meetings: (Meeting & { issues_raised: number; issues_resolved: number })[];
  seriesList: (MeetingSeries & { open_issues_count: number })[];
  onStatusChange: (issueId: string, oldStatus: IssueStatus, newStatus: IssueStatus, seriesId: string) => void;
}) {
  const openIssues = issues.filter(
    (i) => i.status !== "resolved" && i.status !== "dropped"
  );

  const sortedMeetings = React.useMemo(
    () => [...meetings].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [meetings]
  );
  const lastMeeting = sortedMeetings[0];
  const lastMeetingDate = lastMeeting ? new Date(lastMeeting.date) : null;

  const { carried, newSinceLast, stuck } = React.useMemo(() => {
    const carried: Issue[] = [];
    const newSinceLast: Issue[] = [];
    const stuck: Issue[] = [];

    for (const issue of openIssues) {
      const createdAt = new Date(issue.created_at);
      const isNew = lastMeetingDate && createdAt > lastMeetingDate;

      if (isNew) {
        newSinceLast.push(issue);
      } else {
        carried.push(issue);
        if (daysSince(issue.updated_at) >= 7) {
          stuck.push(issue);
        }
      }
    }

    return { carried, newSinceLast, stuck };
  }, [openIssues, lastMeetingDate]);

  const meetingCount = (issue: Issue): number => {
    if (!lastMeetingDate) return 1;
    const created = new Date(issue.created_at);
    const daysSinceCreated = Math.round(
      (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)
    );
    return Math.max(1, Math.ceil(daysSinceCreated / 7));
  };

  return (
    <WidgetShell id={id} index={index}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display text-lg font-semibold text-ink">
          Meeting triage
        </h3>
        <span className="text-[11px] text-ink-4">
          Review in order: carried first, then new, then stuck
        </span>
      </div>

      <div className="space-y-6 mt-5">
        {/* Carried */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="size-2.5 rounded-sm bg-accent" />
            <span className="text-sm font-semibold text-ink">Carried</span>
            <span className="text-xs font-mono text-accent">{carried.length}</span>
            <span className="ml-auto text-[11px] text-ink-4">
              Open for 2+ consecutive meetings
            </span>
          </div>
          <div className="space-y-1">
            {carried.slice(0, 5).map((issue) => (
              <TriageRow
                key={issue.id}
                issue={issue}
                badge={
                  <span className="text-[10px] font-mono text-accent bg-accent-soft px-1.5 py-0.5 rounded">
                    {meetingCount(issue)}th meeting
                  </span>
                }
                onStatusChange={onStatusChange}
              />
            ))}
            {carried.length > 5 && (
              <p className="text-xs text-ink-4 pl-3 pt-1">
                +{carried.length - 5} more carried items
              </p>
            )}
          </div>
        </div>

        {/* New since last */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="size-2.5 rounded-sm bg-success" />
            <span className="text-sm font-semibold text-ink">New since last</span>
            <span className="text-xs font-mono text-success">{newSinceLast.length}</span>
            {lastMeeting && (
              <span className="ml-auto text-[11px] text-ink-4">
                Raised after meeting #{lastMeeting.sequence_number}
              </span>
            )}
          </div>
          <div className="space-y-1">
            {newSinceLast.length === 0 ? (
              <p className="text-xs text-ink-4 pl-3">No new items since last meeting</p>
            ) : (
              newSinceLast.slice(0, 5).map((issue) => (
                <TriageRow key={issue.id} issue={issue} onStatusChange={onStatusChange} />
              ))
            )}
            {newSinceLast.length > 5 && (
              <p className="text-xs text-ink-4 pl-3 pt-1">
                +{newSinceLast.length - 5} more new items
              </p>
            )}
          </div>
        </div>

        {/* Stuck */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="size-2.5 rounded-sm bg-ink-4" />
            <span className="text-sm font-semibold text-ink">Stuck</span>
            <span className="text-xs font-mono text-ink-4">{stuck.length}</span>
            <span className="ml-auto text-[11px] text-ink-4">
              No status change or updates since last meeting
            </span>
          </div>
          <div className="space-y-1">
            {stuck.length === 0 ? (
              <p className="text-xs text-ink-4 pl-3">Nothing stuck. Nice.</p>
            ) : (
              stuck.slice(0, 5).map((issue) => (
                <TriageRow
                  key={issue.id}
                  issue={issue}
                  badge={
                    <span className="text-[10px] font-mono text-ink-4">
                      {daysSince(issue.updated_at)}d no update
                    </span>
                  }
                  onStatusChange={onStatusChange}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </WidgetShell>
  );
}

function TriageRow({
  issue,
  badge,
  onStatusChange,
}: {
  issue: Issue;
  badge?: React.ReactNode;
  onStatusChange: (issueId: string, oldStatus: IssueStatus, newStatus: IssueStatus, seriesId: string) => void;
}) {
  return (
    <div className="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 hover:bg-paper-2 transition-colors">
      <CategoryBadge category={issue.category} size="sm" />
      <Link
        href={`/issues/${issue.id}`}
        className="flex-1 min-w-0 text-sm font-medium text-ink group-hover:text-accent transition-colors truncate basis-[120px]"
      >
        {issue.title}
      </Link>
      {badge}
      <StatusChip
        status={issue.status}
        onChange={(s) => onStatusChange(issue.id, issue.status, s, issue.series_id)}
      />
      {issue.owner_name && (
        <span className="hidden sm:inline-flex items-center justify-center size-6 rounded-full bg-paper-3 text-[10px] font-medium text-ink shrink-0" title={issue.owner_name}>
          {issue.owner_name.charAt(0).toUpperCase()}
        </span>
      )}
      {issue.due_date && (() => {
        const due = new Date(issue.due_date);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);
        const diff = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const overdue = diff < 0;
        const label = overdue
          ? `Overdue ${Math.abs(diff)}d`
          : `Due ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
        return (
          <span className={cn("text-xs font-mono tabular-nums shrink-0", overdue ? "text-accent font-medium" : "text-ink-4")}>
            {label}
          </span>
        );
      })()}
    </div>
  );
}
