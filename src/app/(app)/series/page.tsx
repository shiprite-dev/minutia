"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useSeries } from "@/lib/hooks/use-series";
import { EmptyState } from "@/components/minutia/empty-state";
import { CreateSeriesDialog } from "@/components/minutia/create-series-dialog";
import { MinutiaCadenceIcon } from "@/components/minutia/minutia-icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Cadence } from "@/lib/types";

const cadenceLabels: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  adhoc: "Ad hoc",
};

const detailPanelMotion = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.98 },
  transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] },
} as const;

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function SeriesListPage() {
  const { data: seriesList, isLoading } = useSeries();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [activeSeriesId, setActiveSeriesId] = React.useState<string | null>(
    null
  );
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const showLoading = !mounted || isLoading;

  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-display text-2xl font-semibold text-ink">
            Series
          </h1>
          <Button
            onClick={() => setDialogOpen(true)}
            className="bg-accent text-white hover:bg-accent-hover"
          >
            <Plus className="size-4" data-icon="inline-start" />
            Create series
          </Button>
        </div>

        {/* Loading state */}
        {showLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="bg-card rounded-md p-5 shadow-[var(--shadow-raised)]"
              >
                <Skeleton className="h-5 w-3/4 mb-3" />
                <Skeleton className="h-4 w-1/3 mb-4" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {mounted && !isLoading && seriesList && seriesList.length === 0 && (
          <EmptyState
            variant="no-series"
            onAction={() => setDialogOpen(true)}
          />
        )}

        {/* Series grid */}
        {mounted && !isLoading && seriesList && seriesList.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {seriesList.map((series, i) => (
              <motion.div
                key={series.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.24,
                  delay: i * 0.06,
                  ease: [0.2, 0.8, 0.2, 1],
                }}
                onHoverStart={() => setActiveSeriesId(series.id)}
                onHoverEnd={() =>
                  setActiveSeriesId((current) =>
                    current === series.id ? null : current
                  )
                }
              >
                <Link
                  href={`/series/${series.id}`}
                  onFocus={() => setActiveSeriesId(series.id)}
                  onBlur={() =>
                    setActiveSeriesId((current) =>
                      current === series.id ? null : current
                    )
                  }
                  className="group relative flex h-44 flex-col overflow-visible bg-card rounded-md p-5 shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised-hover)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper outline-none transition-shadow duration-[var(--duration-base)]"
                >
                  <div className="flex h-full flex-col">
                    {/* Name + cadence */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h2 className="font-display font-medium text-ink text-base leading-5 group-hover:text-accent group-focus:text-accent transition-colors line-clamp-2">
                        {series.name}
                      </h2>
                      <Badge
                        variant="secondary"
                        className="shrink-0 gap-1 text-[10px]"
                      >
                        <MinutiaCadenceIcon cadence={series.cadence} className="size-3 text-ink" />
                        {cadenceLabels[series.cadence]}
                      </Badge>
                    </div>

                    <div className="h-10 mb-3">
                      {series.description && (
                        <p className="text-sm leading-5 text-ink-2 line-clamp-2">
                          {series.description}
                        </p>
                      )}
                    </div>

                    {/* Footer meta */}
                    <div className="mt-auto flex min-h-5 items-center gap-3 text-xs text-ink-3">
                      {series.open_issues_count > 0 && (
                        <span
                          className={cn(
                            "font-medium",
                            series.open_issues_count > 5
                              ? "text-accent"
                              : "text-ink-3"
                          )}
                        >
                          {series.open_issues_count} open{" "}
                          {series.open_issues_count === 1 ? "issue" : "issues"}
                        </span>
                      )}
                      <span className="font-mono text-ink-4">
                        Updated {formatDate(series.updated_at)}
                      </span>
                    </div>
                  </div>

                  <AnimatePresence>
                    {activeSeriesId === series.id && (
                      <motion.div
                        data-testid="series-card-detail-panel"
                        className="pointer-events-none absolute left-3 right-3 top-[calc(100%-0.5rem)] z-20 rounded-md border border-rule-strong bg-card px-3 py-2.5 shadow-lg"
                        {...detailPanelMotion}
                      >
                        <p className="font-display text-sm font-medium leading-5 text-ink">
                          {series.name}
                        </p>
                        {series.description && (
                          <p className="mt-1 text-xs leading-5 text-ink-2">
                            {series.description}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-ink-4">
                          <span>{cadenceLabels[series.cadence]}</span>
                          <span aria-hidden="true">/</span>
                          <span>Updated {formatDate(series.updated_at)}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <CreateSeriesDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
