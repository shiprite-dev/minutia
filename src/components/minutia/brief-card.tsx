"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Issue } from "@/lib/types";
import { Send } from "lucide-react";

interface BriefCardProps {
  seriesName: string;
  nextMeetingDate?: Date;
  pendingIssues: Issue[];
  onSendBrief?: () => void;
}

function formatTimeUntil(date: Date): string {
  const now = new Date();
  const diff = new Date(date).getTime() - now.getTime();

  if (diff < 0) return "Overdue";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) return `in ${days}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h`;

  const minutes = Math.floor(diff / (1000 * 60));
  return `in ${minutes}m`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function isOverdue(date: Date | null): boolean {
  if (!date) return false;
  return new Date(date) < new Date();
}

export function BriefCard({
  seriesName,
  nextMeetingDate,
  pendingIssues,
  onSendBrief,
}: BriefCardProps) {
  return (
    <motion.div
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{
        duration: 0.3,
        ease: [0.34, 1.56, 0.64, 1],
      }}
      className="bg-card border border-rule border-t-2 border-t-accent rounded-md overflow-hidden"
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span
              className="inline-block size-2 rounded-full bg-accent"
              aria-hidden="true"
            />
            <span className="text-xs font-medium tracking-wider uppercase text-ink-3">
              Brief
            </span>
          </div>
          {nextMeetingDate && (
            <span className="text-xs font-mono text-ink-3">
              {formatTimeUntil(nextMeetingDate)}
            </span>
          )}
        </div>

        {/* Series name */}
        <h3 className="font-display font-medium text-ink text-lg mb-4">
          {seriesName}
        </h3>

        {/* Pending issues list */}
        {pendingIssues.length > 0 ? (
          <ul className="space-y-2" role="list">
            {pendingIssues.map((issue) => (
              <li
                key={issue.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-ink-2 truncate mr-3">{issue.title}</span>
                <div className="flex items-center gap-3 shrink-0">
                  {issue.owner_name && (
                    <span className="text-xs text-ink-3">
                      {issue.owner_name}
                    </span>
                  )}
                  {issue.due_date && (
                    <span
                      className={cn(
                        "text-xs font-mono",
                        isOverdue(issue.due_date) ? "text-accent" : "text-ink-3"
                      )}
                    >
                      {formatDate(issue.due_date)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">No pending issues.</p>
        )}

        {/* Send button */}
        {onSendBrief && (
          <div className="mt-5 pt-4 border-t border-rule">
            <Button
              variant="default"
              size="sm"
              onClick={onSendBrief}
              className="bg-accent text-white hover:bg-accent-hover"
            >
              <Send className="size-3.5" data-icon="inline-start" />
              Send brief to attendees
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
