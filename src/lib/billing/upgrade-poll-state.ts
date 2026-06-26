// Pure state-machine for the post-upgrade confirmation poll loop.
// Extracted so the race/timeout logic can be TDD'd without a browser.

export type PollPhase = "finalizing" | "done" | "timeout";

// Returns the next phase given the current poll count, whether the entitlement
// flag is set, and the maximum number of polls before giving up.
//
// - "finalizing": still waiting for the webhook to flip the flag
// - "done":       flag is true; show the success confirmation
// - "timeout":    max attempts exhausted with no flip; show a soft fallback
export function nextPollState(
  attempts: number,
  hasAccess: boolean,
  maxAttempts: number
): PollPhase {
  if (hasAccess) return "done";
  if (attempts >= maxAttempts) return "timeout";
  return "finalizing";
}
