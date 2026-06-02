"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TourState = "dismissed" | "completed";
const TOUR_STATE_CHANGE_EVENT = "minutia:first-run-tour-state-change";

type TourStep = {
  title: string;
  body: string;
  target: string;
  route?: string;
};

const TOUR_STEPS: TourStep[] = [
  {
    title: "Your OIL Board",
    body: "This is the control room for open work, pending decisions, and series health.",
    target: "[data-tour='oil-board']",
    route: "/",
  },
  {
    title: "Add widgets",
    body: "Customize the dashboard with meeting, health, and workload panels.",
    target: "[data-tour='add-widget']",
    route: "/",
  },
  {
    title: "Quick add issues",
    body: "Use the floating plus or press N to capture an issue without leaving the board.",
    target: "[data-tour='quick-add']",
    route: "/",
  },
  {
    title: "Search and shortcuts",
    body: "Use Command K to jump anywhere. Press ? whenever you want the full shortcut map.",
    target: "[data-tour='command-palette']",
    route: "/",
  },
  {
    title: "Series are meeting rooms",
    body: "Open recurring meeting series from here. Each one owns its meetings, issues, and decisions.",
    target: "[data-tour='series-nav']",
    route: "/series",
  },
];

function storageKey(userId: string) {
  return `minutia:first-run-tour:${userId}:v1`;
}

function getStoredState(userId: string): TourState | null {
  try {
    const value = window.localStorage.getItem(storageKey(userId));
    return value === "dismissed" || value === "completed" ? value : null;
  } catch {
    return null;
  }
}

function setStoredState(userId: string, value: TourState) {
  try {
    window.localStorage.setItem(storageKey(userId), value);
    window.dispatchEvent(new Event(TOUR_STATE_CHANGE_EVENT));
  } catch {}
}

function isDashboard(pathname: string) {
  return pathname === "/" || pathname === "/dashboard";
}

function subscribeClientState(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(TOUR_STATE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(TOUR_STATE_CHANGE_EVENT, onStoreChange);
  };
}

function subscribeNoop() {
  return () => {};
}

function findVisibleTargetRect(selector: string) {
  for (const target of document.querySelectorAll(selector)) {
    const rect = target.getBoundingClientRect();
    const style = window.getComputedStyle(target);
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    ) {
      return rect;
    }
  }
  return null;
}

export function FirstRunTour({ userId }: { userId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = React.useSyncExternalStore(subscribeNoop, () => true, () => false);
  const stored = React.useSyncExternalStore(
    subscribeClientState,
    () => getStoredState(userId),
    () => null
  );
  const [open, setOpen] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null);
  const [targetInLowerHalf, setTargetInLowerHalf] = React.useState(false);

  const step = TOUR_STEPS[stepIndex];
  const showPrompt = hydrated && stored === null && !open && isDashboard(pathname);

  React.useLayoutEffect(() => {
    if (!open || !step) return;

    function syncTarget() {
      const rect = findVisibleTargetRect(step.target);
      setTargetRect(rect);
      setTargetInLowerHalf(rect ? rect.top > window.innerHeight / 2 : false);
    }

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", syncTarget);
    window.addEventListener("scroll", syncTarget, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncTarget);
      window.removeEventListener("scroll", syncTarget, true);
    };
  }, [open, step]);

  const dismiss = React.useCallback((value: TourState) => {
    setStoredState(userId, value);
    setOpen(false);
  }, [userId]);

  React.useEffect(() => {
    if (!open) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss("dismissed");
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [dismiss, open]);

  function startTour() {
    setStepIndex(0);
    setOpen(true);
  }

  function nextStep() {
    if (stepIndex === TOUR_STEPS.length - 1) {
      dismiss("completed");
      return;
    }
    setTargetRect(null);
    setTargetInLowerHalf(false);
    setStepIndex((current) => current + 1);
  }

  function goToStepRoute() {
    if (step?.route) router.push(step.route);
  }

  return (
    <>
      <AnimatePresence>
        {showPrompt && (
          <motion.aside
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-24 right-4 z-[70] w-[min(calc(100vw-2rem),420px)] rounded-xl border border-rule bg-card p-4 shadow-[0_18px_70px_-24px_oklch(0%_0_0/0.35)] sm:right-6"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
                1
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  We recommend you start the tour first.
                </p>
                <p className="mt-1 text-xs leading-5 text-ink-3">
                  It shows where dashboard panels, issues, series, meetings, and shortcuts live before your first real meeting.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={startTour}
                    className="bg-accent text-white hover:bg-accent-hover"
                  >
                    Start tour
                    <ArrowRight className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismiss("dismissed")}
                    className="text-ink-3 hover:text-ink"
                  >
                    Skip tour
                  </Button>
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && step && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] pointer-events-none"
          >
            <div className="absolute inset-0 bg-ink/10" />
            {targetRect && (
              <div
                data-testid="tour-spotlight"
                className="absolute rounded-xl border-2 border-accent shadow-[0_0_0_9999px_oklch(0%_0_0/0.08)]"
                style={{
                  left: targetRect.left - 8,
                  top: targetRect.top - 8,
                  width: targetRect.width + 16,
                  height: targetRect.height + 16,
                }}
              />
            )}
            <motion.section
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
              className={cn(
                "pointer-events-auto absolute left-4 right-4 rounded-xl border border-rule bg-card p-4 shadow-2xl sm:left-auto sm:right-6 sm:w-[360px]",
                targetInLowerHalf ? "bottom-6" : "bottom-20 sm:bottom-6"
              )}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[11px] font-mono uppercase tracking-wider text-ink-4">
                  Tour {stepIndex + 1} of {TOUR_STEPS.length}
                </p>
                <button
                  type="button"
                  onClick={() => dismiss("dismissed")}
                  className="flex size-7 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-paper-2 hover:text-ink"
                  aria-label="Close tour"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <h2 className="font-display text-lg font-semibold text-ink">
                {step.title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-ink-3">{step.body}</p>
              {!targetRect && step.route && pathname !== step.route && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={goToStepRoute}
                  className="mt-3"
                >
                  Open this area
                </Button>
              )}
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="flex gap-1">
                  {TOUR_STEPS.map((item, index) => (
                    <span
                      key={item.title}
                      className={cn(
                        "h-1.5 rounded-full transition-all",
                        index === stepIndex ? "w-6 bg-accent" : "w-2 bg-rule"
                      )}
                    />
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={nextStep}
                  className="bg-ink text-paper hover:bg-ink-2"
                >
                  {stepIndex === TOUR_STEPS.length - 1 ? (
                    <>
                      Finish
                      <Check className="size-3.5" />
                    </>
                  ) : (
                    <>
                      Next
                      <ArrowRight className="size-3.5" />
                    </>
                  )}
                </Button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
