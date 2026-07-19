import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bell, Download, ExternalLink } from "lucide-react";
import {
  DESKTOP_RELEASES_URL,
  DESKTOP_REPO_URL,
  DESKTOP_REQUIREMENTS,
  getDesktopRelease,
  type DesktopRelease,
} from "@/lib/desktop-download";

export const metadata: Metadata = {
  title: "Minutia for Mac",
  description:
    "Record your meetings from the menu bar. No bot joins the call. Recaps land in Minutia seconds after you hit stop.",
};

export const revalidate = 300;

const steps = [
  {
    title: "Install and sign in",
    description:
      "Download the app and sign in with your Minutia account. It lives in the menu bar, out of your way.",
  },
  {
    title: "Record from the menu bar",
    description:
      "Start a recording yourself, or let meeting detection prompt you the moment a call begins.",
  },
  {
    title: "Stop and get the recap",
    description:
      "Hit stop and the recap opens in Minutia seconds later, complete with action items.",
  },
];

function DownloadCta({
  release,
  variant,
}: {
  release: DesktopRelease;
  variant: "ink" | "accent";
}) {
  const base =
    "inline-flex items-center gap-2 rounded-md px-6 py-3 text-sm font-medium text-paper transition-colors";
  const solid =
    variant === "ink"
      ? "bg-ink hover:bg-ink-2"
      : "bg-accent hover:bg-accent-hover";

  if (release.available) {
    return (
      <a href={release.downloadUrl} className={`${base} ${solid}`}>
        <Download className="size-4" />
        Download for macOS
      </a>
    );
  }

  return (
    <a
      href={DESKTOP_RELEASES_URL}
      target="_blank"
      rel="noreferrer"
      className={`${base} ${solid}`}
    >
      <Bell className="size-4" />
      Watch for the release
    </a>
  );
}

export default async function DownloadPage() {
  const release = await getDesktopRelease();
  const requirements = release.available
    ? `${release.version} · ${DESKTOP_REQUIREMENTS}`
    : DESKTOP_REQUIREMENTS;

  return (
    <main className="min-h-full bg-paper text-ink font-sans">
      {/* ─── Hero ─── */}
      <section className="mx-auto max-w-3xl px-6 pt-24 pb-20 text-center sm:pt-32 sm:pb-28">
        <p className="text-xs font-mono uppercase tracking-wider text-accent mb-5">
          Minutia for Mac
        </p>
        <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-6xl">
          Record your meetings from the menu bar.
        </h1>
        <p className="mt-6 text-lg text-ink-2 sm:text-xl">
          No bot joins the call. Minutia captures your mic and system audio
          right from the menu bar, and the recap lands in your workspace seconds
          after you hit stop.
        </p>
        <div className="mt-10 flex items-center justify-center">
          <DownloadCta release={release} variant="ink" />
        </div>
        <p className="mt-3 text-xs text-ink-4">{requirements}</p>
        {!release.available && (
          <p className="mt-2 text-xs text-ink-4">
            Not shipped yet. Watch the repo and GitHub tells you the moment the
            first signed build lands.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-4">
          Open source.{" "}
          <a
            href={DESKTOP_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:text-accent-hover"
          >
            View it on GitHub
            <ExternalLink className="size-3" />
          </a>
        </p>
      </section>

      {/* ─── How it works ─── */}
      <section className="mx-auto max-w-5xl px-6 py-16 border-t border-rule">
        <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl text-center mb-12">
          How it works
        </h2>
        <div className="grid gap-8 sm:grid-cols-3">
          {steps.map((step, i) => (
            <div key={step.title} className="flex gap-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft font-mono text-sm text-accent">
                {i + 1}
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold text-ink">
                  {step.title}
                </h3>
                <p className="mt-1 text-sm text-ink-2">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="border-t border-rule">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          {release.available ? (
            <>
              <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
                Bring your meetings in automatically.
              </h2>
              <p className="mt-4 text-ink-2">
                Sign in with your Minutia account and start capturing in
                minutes.
              </p>
              <div className="mt-8">
                <DownloadCta release={release} variant="accent" />
              </div>
              <p className="mt-3 text-xs text-ink-4">{requirements}</p>
            </>
          ) : (
            <>
              <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
                Start capturing on the web today.
              </h2>
              <p className="mt-4 text-ink-2">
                The Mac companion is on the way. Minutia runs in your browser
                right now, and the desktop app slots in the moment it ships.
              </p>
              <div className="mt-8">
                <Link
                  href="/login?mode=signup"
                  className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-3 text-sm font-medium text-paper transition-colors hover:bg-accent-hover"
                >
                  Get started free
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-rule">
        <div className="mx-auto max-w-5xl px-6 py-8 flex items-center justify-between">
          <Link href="/" className="font-display text-sm font-semibold text-ink">
            Minutia
          </Link>
          <p className="text-xs text-ink-4">
            The open-source Outstanding Issues Log. Run it yourself.
          </p>
        </div>
      </footer>
    </main>
  );
}
