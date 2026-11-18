"use client";

import * as React from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

export function failedQueries(...queries: UseQueryResult<unknown>[]) {
  return queries.filter(
    (q) =>
      q.data === undefined &&
      (q.isError ||
        q.failureCount > 0 ||
        (q.isPending && q.fetchStatus === "paused")),
  );
}

export function LoadError({ failed }: { failed: UseQueryResult<unknown>[] }) {
  const [clicked, setClicked] = React.useState(false);
  const retrying =
    clicked || failed.some((q) => q.isFetching && q.status === "pending");

  async function retry() {
    setClicked(true);
    await Promise.allSettled(failed.map((q) => q.refetch()));
    setClicked(false);
  }

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
      <Button variant="outline" size="sm" disabled={retrying} onClick={retry}>
        {retrying ? "Retrying..." : "Retry"}
      </Button>
    </div>
  );
}
