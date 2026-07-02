import type { Issue } from "@/lib/types";
import { PRIORITY_CONFIG } from "@/lib/constants";

export function formatIssueKey(issue: Pick<Issue, "issue_number">): string {
  return `OIL-${issue.issue_number}`;
}

export function parseIssueKey(value: string): number | null {
  const match = /^OIL-(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const issueNumber = Number(match[1]);
  return Number.isSafeInteger(issueNumber) && issueNumber > 0
    ? issueNumber
    : null;
}

export function isOpen(issue: Issue): boolean {
  return issue.status !== "resolved" && issue.status !== "dropped";
}

export function isOverdue(issue: Issue): boolean {
  if (issue.status === "resolved" || issue.status === "dropped") return false;
  if (!issue.due_date) return false;
  return new Date(issue.due_date) < new Date();
}

// Manual drag order (positive sort_order) wins; issues that have never been
// dragged share sort_order 0 and fall back to priority, then newest-first, so
// the board keeps its priority ordering until a user deliberately reorders.
export const byManualOrder = (a: Issue, b: Issue) =>
  a.sort_order - b.sort_order ||
  (PRIORITY_CONFIG[a.priority]?.order ?? 99) -
    (PRIORITY_CONFIG[b.priority]?.order ?? 99) ||
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
