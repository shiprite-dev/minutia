export default function GuestSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4">
      <div className="text-center">
        <h1 className="font-display text-xl font-semibold text-ink">minutia</h1>
        <p className="mt-2 text-sm text-ink-2">
          Shared view coming soon.
        </p>
      </div>
    </div>
  );
}
