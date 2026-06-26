"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle, Loader2, RefreshCw, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { nextPollState, type PollPhase } from "@/lib/billing/upgrade-poll-state";

const POLL_INTERVAL_MS = 2_000;
// ~45s window: 22 polls x 2s each (plus the initial immediate check).
const MAX_ATTEMPTS = 22;

// Shown when the URL contains ?upgraded=1. Polls profiles.has_full_access
// directly (not useAiAccess, which short-circuits when feature gating is off)
// to absorb the webhook-race window between payment redirect and flag flip.
// Renders nothing when the param is absent, so it is zero-cost on normal nav.
export function UpgradeConfirmation() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activated = searchParams.get("upgraded") === "1";

  const [phase, setPhase] = useState<PollPhase>("finalizing");
  const [dismissed, setDismissed] = useState(false);
  const attemptsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the real entitlement flag until it flips or the timeout elapses.
  useEffect(() => {
    if (!activated) return;

    const supabase = createClient();

    async function checkAccess() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("has_full_access")
        .eq("id", user.id)
        .single();

      attemptsRef.current += 1;
      const next = nextPollState(
        attemptsRef.current,
        data?.has_full_access === true,
        MAX_ATTEMPTS
      );
      setPhase(next);

      if (next !== "finalizing" && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    checkAccess();
    timerRef.current = setInterval(checkAccess, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activated]);

  // Once confirmed, strip ?upgraded=1 so a page refresh does not re-trigger.
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      params.delete("upgraded");
      const search = params.toString();
      router.replace(
        search
          ? `${window.location.pathname}?${search}`
          : window.location.pathname
      );
    }, 2_500);
    return () => clearTimeout(t);
  }, [phase, router]);

  // Keyboard dismiss.
  useEffect(() => {
    if (!activated || dismissed) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDismissed(true);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activated, dismissed]);

  return (
    <AnimatePresence>
      {(!activated || dismissed) ? null : (
      <motion.div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="upgrade-confirmation"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        className="fixed bottom-6 left-1/2 z-50 w-[min(360px,calc(100vw-2rem))] -translate-x-1/2"
      >
        <div className="relative flex items-start gap-3 rounded-xl border border-rule bg-paper px-4 py-3.5 shadow-lg">
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            className="absolute right-2.5 top-2.5 flex items-center justify-center rounded-md p-1 text-ink-4 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
          >
            <X className="size-3" />
          </button>

          {phase === "finalizing" && (
            <>
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-ink pr-5">
                  Finalizing your upgrade
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  Setting up your account. This takes just a moment.
                </p>
              </div>
            </>
          )}

          {phase === "done" && (
            <>
              <motion.div
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 520, damping: 28 }}
                aria-hidden="true"
              >
                <CheckCircle className="mt-0.5 size-4 shrink-0 text-success" />
              </motion.div>
              <div>
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12, duration: 0.22 }}
                  className="text-sm font-medium text-ink pr-5"
                >
                  You&apos;re all set
                </motion.p>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.26, duration: 0.22 }}
                  className="mt-0.5 text-xs text-ink-3"
                >
                  AI features are unlocked.
                </motion.p>
              </div>
            </>
          )}

          {phase === "timeout" && (
            <>
              <div
                className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-ink-3"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-medium text-ink pr-5">
                  This is taking a moment
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  Your access will unlock automatically. If it does not appear,
                  refresh the page.
                </p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-hover"
                >
                  <RefreshCw className="size-3" aria-hidden="true" />
                  Refresh
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
