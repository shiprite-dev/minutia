import type { Issue } from "@/lib/types";

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
