export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="text-center max-w-sm">
        <p className="text-6xl mb-6" aria-hidden="true">
          ·
        </p>
        <h1 className="font-display text-2xl font-bold text-ink mb-2">
          You are offline
        </h1>
        <p className="text-sm text-ink-3">
          Check your connection and try again.
        </p>
      </div>
    </div>
  );
}
