import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

export function failedQueries(...queries: UseQueryResult<unknown>[]) {
  return queries.filter(
    (q) =>
      q.data === undefined &&
      (q.isError || (q.isPending && q.fetchStatus === "paused")),
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 py-20 text-center"
    >
      <p className="font-display text-base font-medium text-ink">
        Couldn&apos;t load this page.
      </p>
      <p className="max-w-xs text-[13px] text-ink-3">
        Check your connection and try again. Nothing was lost.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
