export const REVIEW_CLAIM_STALE_MS = 2 * 60 * 1000;

export function isOpenForReview(
  suggestion: { status: string; reviewing_at: string | null },
  now = Date.now(),
): boolean {
  if (suggestion.status === "pending") return true;
  return (
    suggestion.status === "reviewing" &&
    !!suggestion.reviewing_at &&
    now - Date.parse(suggestion.reviewing_at) > REVIEW_CLAIM_STALE_MS
  );
}
