import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-4 text-center">
      <h1 className="font-display text-5xl font-semibold text-ink">404</h1>
      <p className="mt-3 text-lg text-ink-3">Page not found</p>
      <p className="mt-1 max-w-md text-sm text-ink-4">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      >
        Back to home
      </Link>
    </main>
  );
}
