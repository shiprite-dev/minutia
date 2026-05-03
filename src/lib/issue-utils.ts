import type { Issue } from "@/lib/types";

export function isOpen(issue: Issue): boolean {
  return issue.status !== "resolved" && issue.status !== "dropped";
}

export function isOverdue(issue: Issue): boolean {
  if (issue.status === "resolved" || issue.status === "dropped") return false;
  if (!issue.due_date) return false;
  return new Date(issue.due_date) < new Date();
}
