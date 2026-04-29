"use client";

import * as React from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { useSeries } from "@/lib/hooks/use-series";
import { EmptyState } from "@/components/minutia/empty-state";
import { CreateSeriesDialog } from "@/components/minutia/create-series-dialog";
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

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function SeriesListPage() {
  const { data: seriesList, isLoading } = useSeries();
  const [dialogOpen, setDialogOpen] = React.useState(false);

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
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="bg-card border border-rule rounded-md p-5"
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
        {!isLoading && seriesList && seriesList.length === 0 && (
          <EmptyState
            variant="no-series"
            onAction={() => setDialogOpen(true)}
          />
        )}

        {/* Series grid */}
        {!isLoading && seriesList && seriesList.length > 0 && (
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
              >
                <Link
                  href={`/series/${series.id}`}
                  className="block bg-card border border-rule rounded-md p-5 hover:border-rule-strong transition-colors group"
                >
                  {/* Name + cadence */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h2 className="font-display font-medium text-ink text-base group-hover:text-accent transition-colors truncate">
                      {series.name}
                    </h2>
                    <Badge
                      variant="secondary"
                      className="shrink-0 text-[10px]"
                    >
                      {cadenceLabels[series.cadence]}
                    </Badge>
                  </div>

                  {/* Description */}
                  {series.description && (
                    <p className="text-sm text-ink-2 line-clamp-2 mb-3">
                      {series.description}
                    </p>
                  )}

                  {/* Footer meta */}
                  <div className="flex items-center gap-3 text-xs text-ink-3">
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
