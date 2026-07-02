/**
 * Grace-window delete registry. A deleted issue is hidden optimistically and
 * its id parked here while a Sonner "Undo" toast is up. Nothing is deleted on
 * the server until the toast closes (commit) — so every failure fails OPEN
 * (worst case: a hidden row reappears; never data loss).
 *
 * Module scope (not component state) so the id survives navigation and the
 * root-mounted Toaster owns the clock. The queryFns of useIssues/useMeeting
 * filter on `isPendingDelete` so the 2s meeting poll cannot resurrect the row.
 */
type Phase = "waiting" | "committing";

const pending = new Map<string, Phase>();

export const isPendingDelete = (id: string): boolean => pending.has(id);

export const beginPendingDelete = (id: string): void => {
  pending.set(id, "waiting");
};

/** Undo is only possible while still "waiting"; once "committing" it is too late. */
export function undoPendingDelete(id: string): boolean {
  if (pending.get(id) !== "waiting") return false;
  pending.delete(id);
  return true;
}

export const markCommitting = (id: string): void => {
  pending.set(id, "committing");
};

export const clearPendingDelete = (id: string): void => {
  pending.delete(id);
};
