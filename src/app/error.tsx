"use client";

import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import Link from "next/link";

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-danger-soft mb-4">
        <AlertTriangle className="size-6 text-danger" />
      </div>
      <h1 className="font-display text-2xl font-semibold text-ink mb-2">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm text-ink-2 mb-6">
        An unexpected error occurred. You can try again, or head back to the
        home page if the problem persists.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <RotateCcw className="size-3.5 mr-1.5" />
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center rounded-md border border-rule bg-paper px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paper-2"
        >
          <Home className="size-3.5 mr-1.5" />
          Home
        </Link>
      </div>
    </main>
  );
}
