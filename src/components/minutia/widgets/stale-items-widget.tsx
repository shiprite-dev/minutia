"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { WidgetShell } from "./widget-shell";
import type { Issue } from "@/lib/types";
import { daysSince } from "@/lib/date-utils";

export function StaleItemsWidget({
  id,
  index,
  issues,
}: {
  id: string;
  index: number;
  issues: Issue[];
}) {
  const staleThreshold = 14;
  const staleItems = React.useMemo(() => {
    return issues
      .filter(
        (i) =>
          i.status !== "resolved" &&
          i.status !== "dropped" &&
          daysSince(i.updated_at) >= staleThreshold
      )
      .sort((a, b) => daysSince(b.updated_at) - daysSince(a.updated_at));
  }, [issues]);

  const oldest = staleItems[0];

  return (
    <WidgetShell id={id} index={index}>
      <div className="flex items-center gap-2 mb-3">
        <span className="size-2 rounded-full bg-accent" />
        <h3 className="font-display text-base font-semibold text-ink">
          Needs attention
        </h3>
      </div>

      <p className="font-display text-4xl font-bold text-ink tabular-nums mb-1">
        {staleItems.length}
      </p>
      <p className="text-sm text-ink-2 mb-4">
        item{staleItems.length !== 1 ? "s" : ""} stale for {staleThreshold}+ days
      </p>

      {oldest && (
        <div className="border-t border-rule pt-3">
          <p className="text-[11px] text-ink-4 mb-1">Oldest stale item</p>
          <Link
            href={`/issues/${oldest.id}`}
            className="text-sm font-medium text-ink hover:text-accent transition-colors"
          >
            {oldest.title}
          </Link>
          <p className="text-xs font-mono text-accent mt-0.5">
            {daysSince(oldest.updated_at)}d, no updates
          </p>
        </div>
      )}

      {staleItems.length === 0 && (
        <p className="text-xs text-ink-3">All items have recent activity.</p>
      )}
    </WidgetShell>
  );
}
