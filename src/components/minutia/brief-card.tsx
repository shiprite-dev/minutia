"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Issue } from "@/lib/types";
import { Send, Copy, Check, Mail } from "lucide-react";
import { isDateOverdue } from "@/lib/date-utils";

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
        parts.push(isDateOverdue(issue.due_date) ? `OVERDUE ${dueStr}` : `due ${dueStr}`);
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
  const [sent, setSent] = React.useState(false);
  const mailtoRef = React.useRef<HTMLAnchorElement>(null);

  const briefText = React.useMemo(
    () => generateBriefText(seriesName, pendingIssues, nextMeetingDate),
    [seriesName, pendingIssues, nextMeetingDate]
  );

  const subject = `Pre-Meeting Brief: ${seriesName}`;
  const emailAttendees = attendees.filter((a) => a.includes("@"));
  const hasEmails = emailAttendees.length > 0;

  const mailtoHref = hasEmails
    ? `mailto:${emailAttendees.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(briefText)}`
    : undefined;

  async function handleSendBrief() {
    try {
      await navigator.clipboard.writeText(briefText);
    } catch {
      // Clipboard API unavailable (e.g. headless browser)
    }

    if (hasEmails && mailtoRef.current) {
      mailtoRef.current.click();
    }

    setSent(true);
    setTimeout(() => setSent(false), 3000);
  }

  async function handleCopyBrief() {
    try {
      await navigator.clipboard.writeText(briefText);
    } catch {
      // Clipboard API unavailable (e.g. headless browser)
    }
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
            <span className="text-xs font-mono font-medium tracking-wider uppercase text-ink-3">
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
                        isDateOverdue(issue.due_date) ? "text-accent" : "text-ink-3"
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
          {mailtoHref && (
            <a
              ref={mailtoRef}
              href={mailtoHref}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
          )}
          <Button
            variant="default"
            size="sm"
            onClick={handleSendBrief}
            className="bg-accent text-white hover:bg-accent-hover"
            data-testid="send-brief-btn"
          >
            {sent ? (
              <Check className="size-3.5" data-icon="inline-start" />
            ) : hasEmails ? (
              <Send className="size-3.5" data-icon="inline-start" />
            ) : (
              <Mail className="size-3.5" data-icon="inline-start" />
            )}
            {sent
              ? hasEmails
                ? "Opened in mail app"
                : "Brief copied!"
              : hasEmails
                ? "Send brief to attendees"
                : "Copy brief to send"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyBrief}
            data-testid="copy-brief-btn"
            className="relative overflow-hidden"
          >
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span
                  key="copied"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.16 }}
                  className="inline-flex items-center gap-1"
                >
                  <Check className="size-3.5 text-success" />
                  Copied
                </motion.span>
              ) : (
                <motion.span
                  key="copy"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.16 }}
                  className="inline-flex items-center gap-1"
                >
                  <Copy className="size-3.5" />
                  Copy
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
