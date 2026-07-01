"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { CalendarClock, X } from "lucide-react";

// Dismissible banner shown above auto-drafted agenda items on an upcoming meeting.
export function CalendarDraftNotice({ count }: { count: number }) {
  const [dismissed, setDismissed] = React.useState(false);
  if (count < 1) return null;

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          role="status"
          className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3"
        >
          <CalendarClock className="size-4 shrink-0 text-accent mt-0.5" aria-hidden="true" />
          <p className="flex-1 text-sm text-ink-2">
            <span className="font-medium text-ink">
              {count} agenda {count === 1 ? "item" : "items"} drafted from this calendar event.
            </span>{" "}
            Review and promote what should stick.
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 text-ink-4 hover:text-ink-2 transition-colors"
          >
            <X className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
