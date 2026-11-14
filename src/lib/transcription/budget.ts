// ---------------------------------------------------------------------------
// Retry/fallback budget for one logical audio unit.
//
// Pure decision logic (no provider imports) so the router can stay a thin
// executor and the ladder is contract-testable. The budget bounds a single
// transcription run: at most three provider attempts, one same-provider retry,
// and one provider switch, whatever combination of failures occurs.
// ---------------------------------------------------------------------------

import { TranscriptionError, type TranscriptionErrorCode } from "./shared";

export type RetryClass = "retry_same" | "switch_provider" | "stop";
export type FailureClass = "transient" | "auth_or_config" | "invalid_input" | "cancelled";

export interface RunBudget {
  totalAttempts: number;
  providerSwitches: number;
  /** Attempts made per provider (first attempts and same-provider retries). */
  sameAttempts: Map<string, number>;
  /** Reserved for a provider poll lane; AssemblyAI currently bounds its own
   * polls by the request deadline. */
  pollRetries: number;
}

export const BUDGET_LIMITS = {
  maxAttempts: 3,
  maxSwitches: 1,
  maxSameProviderRetries: 1,
  maxPollRetries: 2,
} as const;

export function createRunBudget(): RunBudget {
  return { totalAttempts: 0, providerSwitches: 0, sameAttempts: new Map(), pollRetries: 0 };
}

const AUTH_CODES = new Set<TranscriptionErrorCode>(["no_api_key", "provider_not_configured", "auth_error"]);
const INVALID_CODES = new Set<TranscriptionErrorCode>(["unsupported_format"]);

/**
 * Abort-shaped errors come from the caller's signal (fetch surfaces them as a
 * DOMException named AbortError, and Node can raise code 20 / ABORT_ERR).
 */
function isAbortLike(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, code, cause } = error as { name?: unknown; code?: unknown; cause?: unknown };
  if (name === "AbortError" || code === "ABORT_ERR" || code === 20) return true;
  return cause !== error && cause !== undefined && isAbortLike(cause);
}

/**
 * Classify a provider failure. Typed codes win over the abort heuristic so a
 * timeout (which is internally an abort) stays retryable; the router separately
 * refuses to retry when the caller's own signal is already aborted.
 */
export function classifyFailure(error: unknown): FailureClass {
  if (error instanceof TranscriptionError) {
    if (AUTH_CODES.has(error.code)) return "auth_or_config";
    if (INVALID_CODES.has(error.code)) return "invalid_input";
    return "transient";
  }
  return isAbortLike(error) ? "cancelled" : "transient";
}

/**
 * The next move for the router. Attempt 1 is the first try, so one
 * same-provider retry is allowed before the switch, and the switch itself is
 * capped. Every path stops once the total attempt budget is spent.
 */
export function nextDecision(
  budget: RunBudget,
  provider: string,
  failureClass: FailureClass
): RetryClass {
  if (failureClass === "cancelled") return "stop";
  if (budget.totalAttempts >= BUDGET_LIMITS.maxAttempts) return "stop";

  const canSwitch = budget.providerSwitches < BUDGET_LIMITS.maxSwitches;
  if (failureClass === "auth_or_config" || failureClass === "invalid_input") {
    return canSwitch ? "switch_provider" : "stop";
  }

  const sameCount = budget.sameAttempts.get(provider) ?? 0;
  if (sameCount <= BUDGET_LIMITS.maxSameProviderRetries) return "retry_same";
  return canSwitch ? "switch_provider" : "stop";
}

export function recordAttempt(
  budget: RunBudget,
  provider: string,
  kind: "first" | "retry" | "switch"
): void {
  budget.totalAttempts += 1;
  if (kind === "switch") {
    budget.providerSwitches += 1;
    return;
  }
  budget.sameAttempts.set(provider, (budget.sameAttempts.get(provider) ?? 0) + 1);
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const JITTER_RATIO = 0.2;

/**
 * Exponential backoff (500ms doubling, 8s cap) with +-20% jitter. Retry-After
 * is a floor because the provider asked for at least that long, and the
 * remaining request budget always wins so a wait can never outlive the request.
 */
export function backoffMs(
  attemptIndex: number,
  retryAfterMs: number | null = null,
  remainingMs?: number,
  rng: () => number = Math.random
): number {
  if (remainingMs != null && remainingMs <= 0) return 0;

  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attemptIndex), MAX_BACKOFF_MS);
  const jittered = Math.round(exponential * (1 - JITTER_RATIO + rng() * 2 * JITTER_RATIO));
  let delay = Math.min(jittered, MAX_BACKOFF_MS);
  if (retryAfterMs != null && retryAfterMs > 0) delay = Math.max(delay, retryAfterMs);
  if (remainingMs != null) delay = Math.min(delay, remainingMs);
  return Math.max(0, delay);
}
