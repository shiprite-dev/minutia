"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";

type Briefing = {
  briefing_markdown: string;
  overdue_count: number;
  no_owner_count: number;
  issues_count: number;
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warn" }) {
  const toneClass = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <span className="inline-flex items-baseline gap-1 rounded-full bg-paper px-2.5 py-1 text-xs">
      <span className={`font-semibold ${toneClass}`}>{value}</span>
      <span className="text-ink-3">{label}</span>
    </span>
  );
}

export function CarryoverBriefingPanel({
  meetingId,
  issueCount,
}: {
  meetingId: string;
  issueCount: number;
}) {
  const [briefing, setBriefing] = React.useState<Briefing | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Nothing carried over means nothing to brief.
  if (issueCount === 0) return null;

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/carryover-briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Carry-over briefing could not be generated.");
        return;
      }
      setBriefing(payload as Briefing);
    } catch {
      setError("Carry-over briefing could not be generated.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border bg-paper-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" />
          <h2 className="font-display text-base font-medium text-ink">Carry-over briefing</h2>
        </div>
        {!briefing && (
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {loading ? "Generating" : "Generate briefing"}
          </Button>
        )}
      </div>

      <p className="mt-1 text-xs text-ink-3">
        {issueCount} open {issueCount === 1 ? "item" : "items"} carried from earlier meetings.
      </p>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {briefing && (
        <div className="mt-3">
          <div className="mb-3 flex flex-wrap gap-2">
            <Stat label="open" value={briefing.issues_count} />
            <Stat label="overdue" value={briefing.overdue_count} tone="danger" />
            <Stat label="no owner" value={briefing.no_owner_count} tone="warn" />
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
            {briefing.briefing_markdown}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Regenerate
          </Button>
        </div>
      )}
    </section>
  );
}
