"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function SeriesDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const queryClient = useQueryClient();

  function handleRetry() {
    queryClient.clear();
    reset();
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-danger-soft mb-4">
        <AlertTriangle className="size-6 text-danger" />
      </div>
      <h2 className="font-display text-xl font-semibold text-ink mb-2">
        Series not found
      </h2>
      <p className="max-w-md text-sm text-ink-2 mb-6">
        This series may have been deleted, or the link is invalid.
        Try again or return to the dashboard.
      </p>
      {process.env.NODE_ENV === "development" && error.message && (
        <pre className="mb-6 max-w-lg overflow-auto rounded-md bg-paper-2 px-4 py-3 text-left text-xs text-ink-3">
          {error.message}
        </pre>
      )}
      <div className="flex items-center gap-3">
        <Button onClick={handleRetry} className="bg-accent text-white hover:bg-accent-hover">
          <RotateCcw className="size-3.5 mr-1.5" />
          Try again
        </Button>
        <Link href="/">
          <Button variant="outline">
            <Home className="size-3.5 mr-1.5" />
            Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
