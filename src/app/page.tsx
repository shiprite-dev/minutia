import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

export const metadata: Metadata = {
  title: "Minutia — The open-source meeting memory system",
  description:
    "Stop losing track of meeting outcomes. Minutia is the open-source Outstanding Issues Log for recurring meetings.",
};

const features = [
  {
    title: "Live capture",
    description:
      "Capture issues, decisions, and action items as they happen — during the meeting, not after.",
  },
  {
    title: "OIL board",
    description:
      "A single board of outstanding issues across all your recurring meeting series.",
  },
  {
    title: "AI summaries (Pro)",
    description:
      "Auto-generated meeting summaries and smart triage so nothing falls through the cracks.",
  },
  {
    title: "Decisions log",
    description:
      "A durable, searchable log of every decision your team makes in recurring meetings.",
  },
];

const plans = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    features: ["Manual capture", "Up to 25 items", "OIL board", "Decisions log"],
    cta: "Get started free",
    href: "/login?mode=signup",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$5",
    cadence: "/ month",
    features: [
      "Everything in Free",
      "AI summaries",
      "Smart triage",
      "Unlimited items",
      "Priority support",
    ],
    cta: "Start with Pro",
    href: "/login?mode=signup",
    highlighted: true,
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-full bg-paper text-ink font-sans">
      {/* ─── Hero ─── */}
      <section className="mx-auto max-w-3xl px-6 pt-24 pb-20 text-center sm:pt-32 sm:pb-28">
        <p className="text-xs font-mono uppercase tracking-wider text-accent mb-5">
          The open-source meeting memory system
        </p>
        <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-6xl">
          Stop losing track of meeting outcomes.
        </h1>
        <p className="mt-6 text-lg text-ink-2 sm:text-xl">
          Minutia is the Outstanding Issues Log for recurring meetings — a
          durable record of decisions, action items, and follow-ups that never
          disappears into a forgotten doc.
        </p>
        <div className="mt-10 flex items-center justify-center">
          <Link
            href="/login?mode=signup"
            className="inline-flex items-center gap-2 rounded-md bg-ink px-6 py-3 text-sm font-medium text-paper transition-colors hover:bg-ink-2"
          >
            Get started free
            <ArrowRight className="size-4" />
          </Link>
        </div>
        <p className="mt-3 text-xs text-ink-4">
          No credit card required. Open source.
        </p>
      </section>

      {/* ─── Features ─── */}
      <section className="mx-auto max-w-5xl px-6 py-16 border-t border-rule">
        <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl text-center mb-12">
          Everything you need to keep meetings accountable
        </h2>
        <div className="grid gap-8 sm:grid-cols-2">
          {features.map((feature) => (
            <div key={feature.title} className="flex gap-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Check className="size-4" />
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold text-ink">
                  {feature.title}
                </h3>
                <p className="mt-1 text-sm text-ink-2">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section className="mx-auto max-w-4xl px-6 py-16 border-t border-rule">
        <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl text-center mb-12">
          Simple, honest pricing
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={
                "flex flex-col rounded-md border p-6 " +
                (plan.highlighted
                  ? "border-accent bg-accent-soft"
                  : "border-rule bg-paper-2")
              }
            >
              <h3 className="font-display text-lg font-semibold text-ink">
                {plan.name}
              </h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold text-ink">
                  {plan.price}
                </span>
                <span className="text-sm text-ink-3">{plan.cadence}</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-ink-2">
                    <Check className="size-4 shrink-0 text-accent" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={plan.href}
                className={
                  "mt-8 inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium transition-colors " +
                  (plan.highlighted
                    ? "bg-ink text-paper hover:bg-ink-2"
                    : "border border-ink text-ink hover:bg-ink hover:text-paper")
                }
              >
                {plan.cta}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="border-t border-rule">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
            Ready to own your meeting memory?
          </h2>
          <p className="mt-4 text-ink-2">
            Set up in minutes. Free forever for small teams.
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
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-rule">
        <div className="mx-auto max-w-5xl px-6 py-8 flex items-center justify-between">
          <span className="font-display text-sm font-semibold text-ink">
            Minutia
          </span>
          <p className="text-xs text-ink-4">
            Open-source meeting memory. Run it yourself.
          </p>
        </div>
      </footer>
    </main>
  );
}