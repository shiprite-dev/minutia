"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Issue } from "@/lib/types";
import { Send, Copy, Check } from "lucide-react";

interface BriefCardProps {
  seriesName: string;
  nextMeetingDate?: Date;
  pendingIssues: Issue[];
  attendees?: string[];
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

function generateBriefText(
  seriesName: string,
  pendingIssues: Issue[],
  nextMeetingDate?: Date
): string {
  const lines: string[] = [];
  lines.push(`Pre-Meeting Brief: ${seriesName}`);
  lines.push("");

  if (nextMeetingDate) {
    const dateStr = new Date(nextMeetingDate).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    lines.push(`Next meeting: ${dateStr}`);
    lines.push("");
  }

  if (pendingIssues.length === 0) {
    lines.push("No pending items. All clear!");
  } else {
    lines.push(`${pendingIssues.length} item${pendingIssues.length === 1 ? "" : "s"} pending:`);
    lines.push("");
    for (const issue of pendingIssues) {
      const parts: string[] = [`- ${issue.title}`];
      if (issue.owner_name) parts.push(`(${issue.owner_name})`);
      if (issue.due_date) {
        const dueStr = formatDate(issue.due_date);
        parts.push(isOverdue(issue.due_date) ? `OVERDUE ${dueStr}` : `due ${dueStr}`);
      }
      lines.push(parts.join("  "));
    }
  }

  lines.push("");
  lines.push("Sent via Minutia");
  return lines.join("\n");
}

export function BriefCard({
  seriesName,
  nextMeetingDate,
  pendingIssues,
  attendees = [],
}: BriefCardProps) {
  const [copied, setCopied] = React.useState(false);

  const briefText = React.useMemo(
    () => generateBriefText(seriesName, pendingIssues, nextMeetingDate),
    [seriesName, pendingIssues, nextMeetingDate]
  );

  const subject = `Pre-Meeting Brief: ${seriesName}`;

  function handleSendBrief() {
    const mailto = `mailto:${attendees.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(briefText)}`;
    window.open(mailto, "_blank");
  }

  async function handleCopyBrief() {
    await navigator.clipboard.writeText(briefText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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

        {/* Send / Copy buttons */}
        <div className="mt-5 pt-4 border-t border-rule flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleSendBrief}
            className="bg-accent text-white hover:bg-accent-hover"
            data-testid="send-brief-btn"
          >
            <Send className="size-3.5" data-icon="inline-start" />
            Send brief to attendees
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyBrief}
            data-testid="copy-brief-btn"
          >
            {copied ? (
              <Check className="size-3.5 text-green-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
