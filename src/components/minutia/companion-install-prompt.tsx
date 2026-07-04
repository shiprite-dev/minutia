"use client";

import * as React from "react";
import { X, Download } from "lucide-react";

const DISMISS_KEY = "minutia.companion-prompt-dismissed";
const DOWNLOAD_URL =
  "https://github.com/shiprite-dev/minutia-desktop/releases/latest";

// Inline nudge shown near the recorder when the signed-in user has no companion
// app checked in yet (companion_last_seen_at is null) and has not dismissed it.
export function CompanionInstallPrompt({
  lastSeenAt,
}: {
  lastSeenAt: string | null | undefined;
}) {
  const [dismissed, setDismissed] = React.useState(true);

  React.useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "true");
  }, []);

  if (lastSeenAt || dismissed) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pt-6">
      <div
        role="status"
        className="flex items-center gap-3 rounded-xl border border-rule bg-card px-4 py-3 shadow-[var(--shadow-raised)]"
      >
      <p className="flex-1 text-sm text-ink-2">
        For the best experience, download and install the companion app.
      </p>
      <a
        href={DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
      >
        <Download className="size-4" />
        Download for macOS
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss companion app prompt"
        className="inline-flex size-8 items-center justify-center rounded-lg text-ink-4 hover:bg-paper-2 hover:text-ink-2"
      >
        <X className="size-4" />
      </button>
      </div>
    </div>
  );
}
