"use client";

import * as React from "react";
import Link from "next/link";
import { WidgetShell } from "./widget-shell";
import { cn } from "@/lib/utils";
import type { Issue, MeetingSeries } from "@/lib/types";

export function SeriesHealthWidget({
  id,
  index,
  issues,
  seriesList,
}: {
  id: string;
  index: number;
  issues: Issue[];
  seriesList: (MeetingSeries & { open_issues_count: number })[];
}) {
  const seriesStats = React.useMemo(() => {
    return seriesList.map((series) => {
      const seriesIssues = issues.filter((i) => i.series_id === series.id);
      const total = seriesIssues.length;
      const open = seriesIssues.filter(
        (i) => i.status === "open"
      ).length;
      const inProgress = seriesIssues.filter(
        (i) => i.status === "in_progress" || i.status === "pending"
      ).length;
      const resolved = seriesIssues.filter(
        (i) => i.status === "resolved" || i.status === "dropped"
      ).length;
      const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

      return { series, total, open, inProgress, resolved, resolutionRate };
    });
  }, [issues, seriesList]);

  const healthDot = (rate: number) => {
    if (rate >= 70) return "bg-success";
    if (rate >= 40) return "bg-warn";
    return "bg-accent";
  };

  return (
    <WidgetShell id={id} index={index}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-display text-lg font-semibold text-ink">
          Series health
        </h3>
        <span className="text-[11px] text-ink-4">Status distribution</span>
      </div>

      <div className="space-y-5">
        {seriesStats.map(({ series, total, open, inProgress, resolved, resolutionRate }) => {
          const openPct = total > 0 ? (open / total) * 100 : 0;
          const progressPct = total > 0 ? (inProgress / total) * 100 : 0;
          const resolvedPct = total > 0 ? (resolved / total) * 100 : 0;

          return (
            <div key={series.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className={cn("size-2 rounded-full", healthDot(resolutionRate))} />
                <Link
                  href={`/series/${series.id}`}
                  className="text-sm font-semibold text-ink hover:text-accent transition-colors"
                >
                  {series.name}
                </Link>
                <span className="text-xs text-ink-4 capitalize">
                  {series.cadence === "adhoc" ? "Ad hoc" : series.cadence}
                </span>
                <span className="ml-auto text-xs text-ink-4 tabular-nums">
                  {total} items
                </span>
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums",
                    resolutionRate >= 70 ? "text-success" : resolutionRate >= 40 ? "text-warn" : "text-accent"
                  )}
                >
                  {resolutionRate}% resolved
                </span>
              </div>

              <div className="flex h-2 rounded-full overflow-hidden bg-paper-2">
                {openPct > 0 && (
                  <div className="bg-accent" style={{ width: `${openPct}%` }} />
                )}
                {progressPct > 0 && (
                  <div className="bg-warn" style={{ width: `${progressPct}%` }} />
                )}
                {resolvedPct > 0 && (
                  <div className="bg-success" style={{ width: `${resolvedPct}%` }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-rule">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-accent" />
          <span className="text-[10px] text-ink-4">Open</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-warn" />
          <span className="text-[10px] text-ink-4">In Progress / Pending</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-success" />
          <span className="text-[10px] text-ink-4">Resolved</span>
        </div>
      </div>
    </WidgetShell>
  );
}
