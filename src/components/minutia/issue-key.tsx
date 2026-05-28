import type { Issue } from "@/lib/types";
import { formatIssueKey } from "@/lib/issue-utils";
import { cn } from "@/lib/utils";

interface IssueKeyProps {
  issue: Pick<Issue, "issue_number">;
  className?: string;
}

export function IssueKey({ issue, className }: IssueKeyProps) {
  const key = formatIssueKey(issue);

  return (
    <span
      aria-label={`Issue key ${key}`}
      className={cn(
        "inline-flex h-6 items-center rounded border border-rule bg-paper-2 px-2 font-mono text-[11px] font-medium uppercase text-ink-3",
        className
      )}
    >
      {key}
    </span>
  );
}
