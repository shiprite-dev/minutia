"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Plus, ArrowRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUpsellNoticeUrl } from "@/lib/hooks/use-ai-access";
import { resolveUpsellCta, shouldShowNudge, nudgeStorageKey } from "@/lib/upsell";

// Capacity nudge: the board-full FAB. Replaces the old dead-end (disabled FAB +
// "limit reached" tooltip) with a calm, dismissible explanation and, when the
// instance configures a destination, a neutral CTA. It auto-opens once at the
// moment the board fills (a success moment, not an interruption); dismissing it
// starts a 14-day cooldown so it never nags. Clicking the FAB reopens it anytime.
const SLOT = "capacity" as const;

export function CapacityNudge({ limit }: { limit: number }) {
  const { data } = useUpsellNoticeUrl(SLOT);
  const cta = resolveUpsellCta(data?.ctaUrl);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const raw = window.localStorage.getItem(nudgeStorageKey(SLOT));
    const dismissedAt = raw ? Number(raw) : null;
    if (shouldShowNudge(dismissedAt, Date.now())) setOpen(true);
  }, []);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Closing is a dismissal: record it so the nudge does not auto-open again
    // until the cooldown elapses (clicking the FAB still reopens it on demand).
    if (!next) window.localStorage.setItem(nudgeStorageKey(SLOT), String(Date.now()));
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          data-testid="capacity-nudge-trigger"
          aria-label="Board full"
          className="fixed bottom-6 right-6 z-50 flex size-12 items-center justify-center rounded-full bg-accent text-white shadow-lg transition-colors hover:bg-accent-hover"
          whileTap={{ scale: 0.9 }}
        >
          <Plus className="size-5" />
        </motion.button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={12}
        data-testid="capacity-nudge"
        className="w-72"
      >
        <p className="text-sm font-medium text-ink">
          You&apos;ve filled all {limit} active items.
        </p>
        <p className="mt-1 text-xs text-ink-3">
          Resolve or drop an item to free up space.
        </p>
        {cta && (
          <a
            href={cta.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-hover"
          >
            {cta.label}
            <ArrowRight className="size-3" />
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
