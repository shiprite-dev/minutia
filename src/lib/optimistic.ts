import type { QueryClient, QueryFilters } from "@tanstack/react-query";

/**
 * A single optimistic cache mutation: which queries to touch (`filter`) and how
 * to transform each matching cache (`update`). Snapshotted before applying so it
 * can be rolled back on error.
 */
export type OptimisticPatch = {
  filter: QueryFilters;
  update: (old: unknown) => unknown;
};

/** Typed convenience wrapper so call sites keep inference on the cache shape. */
export function patch<T>(
  filter: QueryFilters,
  update: (old: T) => T
): OptimisticPatch {
  return { filter, update: (old) => update(old as T) };
}

/**
 * Cancel in-flight fetches for the targeted queries, snapshot their current
 * data, apply each patch, and return a `rollback()` that restores the snapshot.
 * The shared core behind every optimistic mutation in the app.
 *
 * Undefined caches are left untouched (never fed to `update`), so patching a
 * query that has not loaded yet is a safe no-op.
 */
export async function applyOptimistic(
  queryClient: QueryClient,
  patches: OptimisticPatch[]
): Promise<{ rollback: () => void }> {
  await Promise.all(patches.map((p) => queryClient.cancelQueries(p.filter)));
  const snapshots = patches.flatMap((p) => queryClient.getQueriesData(p.filter));
  for (const p of patches) {
    queryClient.setQueriesData(p.filter, (old) =>
      old === undefined ? old : p.update(old)
    );
  }
  return {
    rollback: () => {
      for (const [key, data] of snapshots) queryClient.setQueryData(key, data);
    },
  };
}
