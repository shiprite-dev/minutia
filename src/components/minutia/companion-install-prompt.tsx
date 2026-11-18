"use client";

import * as React from "react";
import { X, Download } from "lucide-react";

const dismissKey = (userId: string) =>
  `minutia.companion-prompt-dismissed.${userId}`;

// Inline nudge for a Mac browser whose user has never connected the companion.
export function CompanionInstallPrompt({ userId }: { userId: string }) {
  const [dismissed, setDismissed] = React.useState(true);

  React.useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey(userId)) === "true");
  }, [userId]);

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(dismissKey(userId), "true");
    setDismissed(true);
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pt-6">
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border border-rule bg-card px-4 py-3 shadow-[var(--shadow-raised)]"
      >
      <p className="flex-1 text-sm text-ink-2">
        For the best experience, download and install the Mac app.
      </p>
      <a
        href="/download"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
      >
        <Download className="size-4" />
        Download for Mac
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss Mac app prompt"
        className="inline-flex size-8 items-center justify-center rounded-lg text-ink-4 hover:bg-paper-2 hover:text-ink-2"
      >
        <X className="size-4" />
      </button>
      </div>
    </div>
  );
}
