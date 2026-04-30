"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ShareError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-danger-soft mb-4">
        <AlertTriangle className="size-6 text-danger" />
      </div>
      <h2 className="font-display text-xl font-semibold text-ink mb-2">
        Share link unavailable
      </h2>
      <p className="max-w-md text-sm text-ink-2 mb-6">
        This share link may have expired or been revoked.
        Try refreshing the page.
      </p>
      {process.env.NODE_ENV === "development" && error.message && (
        <pre className="mb-6 max-w-lg overflow-auto rounded-md bg-paper-2 px-4 py-3 text-left text-xs text-ink-3">
          {error.message}
        </pre>
      )}
      <Button onClick={reset} className="bg-accent text-white hover:bg-accent-hover">
        <RotateCcw className="size-3.5 mr-1.5" />
        Try again
      </Button>
    </div>
  );
}
