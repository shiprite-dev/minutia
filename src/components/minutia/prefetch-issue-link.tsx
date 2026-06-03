"use client";

import * as React from "react";
import Link from "next/link";
import { usePrefetchIssueDetail } from "@/lib/hooks/use-prefetch-issue-detail";

type PrefetchIssueLinkProps = Omit<React.ComponentProps<typeof Link>, "href"> & {
  issueId: string;
};

export function PrefetchIssueLink({
  issueId,
  onFocus,
  onPointerEnter,
  onTouchStart,
  ...props
}: PrefetchIssueLinkProps) {
  const prefetchIssue = usePrefetchIssueDetail();

  function warmIssueDetail() {
    prefetchIssue(issueId);
  }

  return (
    <Link
      {...props}
      href={`/issues/${issueId}`}
      onFocus={(event) => {
        warmIssueDetail();
        onFocus?.(event);
      }}
      onPointerEnter={(event) => {
        warmIssueDetail();
        onPointerEnter?.(event);
      }}
      onTouchStart={(event) => {
        warmIssueDetail();
        onTouchStart?.(event);
      }}
    />
  );
}
