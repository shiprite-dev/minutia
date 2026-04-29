"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-4 text-center">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Something went wrong
      </h1>
      <p className="mt-3 max-w-md text-ink-3">
        An unexpected error occurred. You can try again, or head back to the
        home page if the problem persists.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      >
        Try again
      </button>
    </main>
  );
}
