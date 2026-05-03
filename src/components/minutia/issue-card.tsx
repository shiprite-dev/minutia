"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { Issue, IssueStatus, IssueUpdate } from "@/lib/types";
import { STATUS_CONFIG } from "@/lib/constants";
import { StatusChip } from "./status-chip";
import { CategoryBadge } from "./category-badge";
import { PriorityIndicator } from "./priority-indicator";
import { isDateOverdue, formatShortDate } from "@/lib/date-utils";

interface IssueCardProps {
  issue: Issue;
  onStatusChange?: (issueId: string, newStatus: IssueStatus) => void;
  onExpand?: (issueId: string) => void;
  expanded?: boolean;
}

export function IssueCard({
  issue,
  onStatusChange,
  onExpand,
  expanded,
}: IssueCardProps) {
  const overdue = issue.status !== "resolved" && isDateOverdue(issue.due_date);

  function handleStatusChange(newStatus: IssueStatus) {
    onStatusChange?.(issue.id, newStatus);
  }

  function handleExpand() {
    onExpand?.(issue.id);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      handleExpand();
    }
  }

  const isDone = issue.status === "resolved" || issue.status === "dropped";

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{
        opacity: isDone ? 0.6 : 1,
        y: 0,
        backgroundColor: isDone ? "var(--paper-3)" : "var(--card)",
      }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      className="border border-rule rounded-md p-5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="article"
      aria-label={`${issue.title}, ${STATUS_CONFIG[issue.status].label}`}
    >
      {/* Header row: priority + title */}
      <div className="flex items-start gap-3">
        <div className="pt-1">
          <PriorityIndicator priority={issue.priority} />
        </div>
        <div className="flex-1 min-w-0">
          <Link
            href={`/issues/${issue.id}`}
            className={cn(
              "text-left font-sans font-medium transition-colors cursor-pointer",
              isDone ? "text-ink-3 line-through" : "text-ink hover:text-ink-2"
            )}
          >
            {issue.title}
          </Link>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <StatusChip
          status={issue.status}
          onChange={onStatusChange ? handleStatusChange : undefined}
        />
        <CategoryBadge category={issue.category} />

        {issue.owner_name && (
          <span className="text-xs text-ink-3">{issue.owner_name}</span>
        )}

        {issue.due_date && (
          <span
            className={cn(
              "text-xs font-mono",
              overdue ? "text-accent" : "text-ink-3"
            )}
          >
            {overdue && "Overdue: "}
            {formatShortDate(issue.due_date)}
          </span>
        )}
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="relative pt-4 mt-4 pl-4">
              <motion.div
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                exit={{ scaleY: 0 }}
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute left-0 top-4 bottom-0 w-px bg-accent origin-top"
                aria-hidden="true"
              />
              {issue.description && (
                <p className="text-sm text-ink-2 leading-relaxed">
                  {issue.description}
                </p>
              )}

              {/* Issue ID */}
              <div className="mt-3">
                <span className="text-[10px] font-mono text-ink-4 uppercase tracking-wider">
                  {issue.id}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
