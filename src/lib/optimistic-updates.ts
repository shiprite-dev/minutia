/**
 * Pure cache updaters used with `applyOptimistic`. Each returns an immutable
 * `(old) => next` transform over a specific cache shape. Kept free of app/client
 * imports so they unit-test in node (see scripts/verify-optimistic.test.mjs).
 */

/** True when a query's data is a list cache (array), false for a detail object. */
export function isListCache(query: { state: { data: unknown } }): boolean {
  return Array.isArray(query.state.data);
}

export const markRead =
  (id: string) =>
  <T extends { id: string; read: boolean }>(list: T[]): T[] =>
    list.map((n) => (n.id === id ? { ...n, read: true } : n));

export const markAllRead =
  () =>
  <T extends { read: boolean }>(list: T[]): T[] =>
    list.map((n) => (n.read ? n : { ...n, read: true }));

export const patchSeriesFields =
  <T extends { id: string }>(id: string, fields: Partial<T>) =>
  (list: T[]): T[] =>
    list.map((s) => (s.id === id ? { ...s, ...fields } : s));

export const appendDecision =
  <T extends { id: string }>(decision: T) =>
  (list: T[]): T[] =>
    [decision, ...list];

export const removeIssue =
  (id: string) =>
  <T extends { id: string }>(list: T[]): T[] =>
    list.filter((i) => i.id !== id);
