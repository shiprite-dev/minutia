"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { Issue, IssueStatus, IssueUpdate } from "@/lib/types";
import { StatusChip } from "./status-chip";
import { CategoryBadge } from "./category-badge";
import { PriorityIndicator } from "./priority-indicator";

interface IssueCardProps {
  issue: Issue;
  onStatusChange?: (issueId: string, newStatus: IssueStatus) => void;
  onExpand?: (issueId: string) => void;
  expanded?: boolean;
}

function isOverdue(dueDate: Date | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function IssueCard({
  issue,
  onStatusChange,
  onExpand,
  expanded,
}: IssueCardProps) {
  const overdue = issue.status !== "resolved" && isOverdue(issue.due_date);

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

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
      className="bg-card border border-rule rounded-md p-5"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="article"
      aria-label={issue.title}
    >
      {/* Header row: priority + title */}
      <div className="flex items-start gap-3">
        <div className="pt-1">
          <PriorityIndicator priority={issue.priority} />
        </div>
        <div className="flex-1 min-w-0">
          <Link
            href={`/issues/${issue.id}`}
            className="text-left font-sans font-medium text-ink hover:text-ink-2 transition-colors cursor-pointer"
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
            {formatDate(issue.due_date)}
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
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-4 mt-4 border-t border-rule">
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
